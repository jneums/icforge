#!/usr/bin/env node
import { program } from "commander";
import { initCommand } from "./commands/init.js";
import { deployCommand } from "./commands/deploy.js";
import { loginCommand } from "./commands/login.js";
import { devAuthCommand } from "./commands/dev-auth.js";
import { statusCommand } from "./commands/status.js";
import { logsCommand } from "./commands/logs.js";

program
  .name("icforge")
  .description("Deploy to the Internet Computer — zero config, zero crypto")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize an ICForge project in the current directory")
  .option("-n, --name <name>", "Project name")
  .action(initCommand);

program
  .command("login")
  .description("Authenticate with ICForge via browser")
  .action(loginCommand);

program
  .command("dev-auth")
  .description("Authenticate with a local dev backend (requires DEV_MODE=true)")
  .action(devAuthCommand);

program
  .command("deploy")
  .description("Build and deploy your project to the Internet Computer")
  .option("--skip-build", "Skip the local build step")
  .option("-e, --env <environment>", "Target environment", "production")
  .option("-w, --wasm <path>", "Path to a pre-built .wasm file")
  .action(deployCommand);

program
  .command("status")
  .description("Check deployment status and canister info")
  .action(statusCommand);

program
  .command("logs")
  .description("Stream deployment and canister logs")
  .option("-f, --follow", "Follow log output")
  .action(logsCommand);

program.parse();
