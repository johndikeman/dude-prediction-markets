{
  description = "dude-prediction-markets: autonomous prediction market research & trading agent";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    let
      eachSystem = flake-utils.lib.eachDefaultSystem (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
        in
        {
          packages.default = pkgs.buildNpmPackage.override { nodejs = pkgs.nodejs_24; } {
            pname = "dude-prediction-markets";
            version = "0.7.2";
            src = ./.;
            dontNpmBuild = true;
            npmDepsHash = "sha256-ImVyp3kCC8WDeBRjziXEaqUvluypsXQwFmIIHWUrRj4=";
            postInstall = ''
              cp .opvars $out/.opvars
            '';
          };

          devShells.default = pkgs.mkShell {
            buildInputs = with pkgs; [
              nodejs_24
              git
              gh
            ];
          };
        }
      );
    in
    eachSystem
    // rec {
      # home-manager module: systemd user service + timer, fully self-contained.
      # namespaced under "prediction-markets" so it cannot collide with the
      # main dude-agent service.
      homeManagerModules = {
        prediction-markets =
          {
            config,
            lib,
            pkgs,
            ...
          }:
          let
            cfg = config.services.prediction-markets;
          in
          {
            options.services.prediction-markets = {
              enable = lib.mkEnableOption "dude-prediction-markets agent";

              package = lib.mkOption {
                type = lib.types.package;
                default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
                description = "The dude-prediction-markets package to run.";
              };

              interval = lib.mkOption {
                type = lib.types.str;
                default = "*:0/30";
                description = "OnCalendar interval for the check cycle (default every 30 min).";
              };

              stateDir = lib.mkOption {
                type = lib.types.str;
                default = "${config.home.homeDirectory}/.local/state/dude-prediction-markets";
                description = "Directory for strategy/portfolio state.";
              };

              obsidianDir = lib.mkOption {
                type = lib.types.str;
                default = "${config.home.homeDirectory}/vault";
                description = "Obsidian vault path for reports.";
              };

              opvarsFile = lib.mkOption {
                type = lib.types.path;
                default = "${cfg.package}/.opvars";
                description = ''
                  Path to a 1Password .opvars file (op:// secret references).
                  Resolved at runtime via `op run --env-file`.
                '';
              };

              environmentFile = lib.mkOption {
                type = lib.types.nullOr lib.types.path;
                default = null;
                description = ''
                  Environment file with secrets (PM_WALLET_ADDRESS, PM_WALLET_PRIVATE_KEY,
                  PM_TRADING_ENABLED, thresholds). Must also contain
                  OP_SERVICE_ACCOUNT_TOKEN — `op run --env-file .opvars` needs it to
                  resolve the op:// references. Should be a user-readable path.
                '';
              };
            };

            config = lib.mkIf cfg.enable {
              systemd.user.services.prediction-markets = {
                Unit = {
                  Description = "Dude Prediction Markets Agent";
                  After = [ "network.target" ];
                  StartLimitBurst = "5";
                  StartLimitIntervalSec = "120s";
                };
                Service = {
                  Type = "oneshot";
                  ExecStartPre = [
                    "${pkgs.coreutils}/bin/mkdir -p ${cfg.stateDir}"
                    "${pkgs.coreutils}/bin/mkdir -p ${cfg.obsidianDir}"
                  ] ++ lib.optionals (cfg.environmentFile != null) [
                    # fail fast with a clear message if the op token is missing,
                    # otherwise `op run` dies with a cryptic auth error every cycle
                    ("${pkgs.bash}/bin/bash -c 'grep -q OP_SERVICE_ACCOUNT_TOKEN ${cfg.environmentFile} || "
                      + "{ echo prediction-markets: environmentFile missing OP_SERVICE_ACCOUNT_TOKEN; exit 1; }'")
                  ];
                  ExecStart =
                    let
                      opRun = pkgs._1password-cli + "/bin/op run --env-file ${cfg.opvarsFile}";
                    in
                    "${opRun} -- ${cfg.package}/bin/prediction-markets --once";
                  Environment = [
                    "PM_STATE_DIR=${cfg.stateDir}"
                    "OBSIDIAN_DIR=${cfg.obsidianDir}"
                    "HOME=${config.home.homeDirectory}"
                  ];
                  EnvironmentFile = lib.mkIf (cfg.environmentFile != null) [ "-${cfg.environmentFile}" ];
                };
              };

              systemd.user.timers.prediction-markets = {
                Unit.Description = "Dude Prediction Markets Agent Timer";
                Timer = {
                  OnCalendar = cfg.interval;
                  Persistent = true;
                };
                Install.WantedBy = [ "timers.target" ];
              };
            };
          };

        default = homeManagerModules.prediction-markets;
      };
    };
}
