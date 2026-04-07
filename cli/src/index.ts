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
  .version("0.2.0");

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
  .description("Trigger a server-side build and deploy for the current commit")
  .option("-c, --canister <name>", "Deploy only the specified canister")
  .action(deployCommand);

program
  .command("status")
  .description("Check deployment status and canister info")
  .action(statusCommand);

program
  .command("logs")
  .description("Stream deployment and canister logs")
  .option("-d, --deploy <id>", "Show logs for a specific deployment ID")
  .option("-f, --follow", "Follow log output (stream via SSE)")
  .action(logsCommand);

program.parse();
