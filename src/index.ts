#!/usr/bin/env node
import { parseEwp } from "./parser.js";
import { generateCmake } from "./cmake-gen.js";
import { scanFirmwarePack } from "./firmware.js";
import * as path from "path";
import * as fs from "fs";

function printHelp(): void {
  console.log(`
iar2cmake — Convert IAR EWARM projects to CMake/GCC

Usage:
  iar2cmake <project.ewp> [options]

Options:
  -o, --out <dir>       Output directory (default: ./build-cmake)
  -c, --config <name>   Configuration to use (default: first found)
  --fw-path <dir>       Path to STM32Cube FW pack (e.g. STM32Cube_FW_F4)
  --list-configs        List available configurations and exit
  --no-ld               Skip linker script conversion
  --verbose             Print detailed info
  -h, --help            Show this help
  `);
}

function getArg(args: string[], ...flags: string[]): string | undefined {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  }
  return undefined;
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return flags.some(f => args.includes(f));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || hasFlag(args, "--help", "-h")) {
    printHelp();
    return;
  }

  const ewpPath = path.resolve(args[0]);
  if (!fs.existsSync(ewpPath)) {
    console.error(`Error: File not found: ${ewpPath}`);
    process.exit(1);
  }

  const outputDir = path.resolve(getArg(args, "-o", "--out") || "./build-cmake");
  const configName = getArg(args, "-c", "--config");
  const fwPath = getArg(args, "--fw-path");
  const verbose = hasFlag(args, "--verbose");

  console.log(`Parsing: ${ewpPath}`);
  const parsed = parseEwp(ewpPath);

  if (hasFlag(args, "--list-configs")) {
    console.log("\nConfigurations:");
    for (const cfg of parsed.configs) {
      console.log(`  ${cfg.name} (${cfg.device})`);
    }
    return;
  }

  let targetConfig;
  if (configName) {
    targetConfig = parsed.configs.find(c => c.name === configName);
    if (!targetConfig) {
      console.error(`Error: Configuration "${configName}" not found`);
      console.error(`Available: ${parsed.configs.map(c => c.name).join(", ")}`);
      process.exit(1);
    }
  } else {
    targetConfig = parsed.configs[0];
  }

  // Scan firmware pack if provided
  let fw = undefined;
  if (fwPath) {
    const resolvedFw = path.resolve(fwPath);
    console.log(`Scanning FW pack: ${resolvedFw}`);
    fw = scanFirmwarePack(resolvedFw, targetConfig.device);
    if (!fw) {
      console.error(`Error: Could not find firmware for ${targetConfig.device} in ${resolvedFw}`);
      console.error("Make sure the path points to the STM32Cube FW pack root (e.g., STM32Cube_FW_F4)");
      process.exit(1);
    }
    if (verbose) {
      console.log(`  Series: ${fw.mcuSeries}`);
      console.log(`  HAL: ${fw.halPath}`);
      console.log(`  CMSIS: ${fw.cmsisCoreIncPath}`);
      console.log(`  Device: ${fw.cmsisDeviceIncPath}`);
    }
  }

  if (!targetConfig.icfFile) {
    console.warn("Warning: No .icf file found in project");
  }

  fs.mkdirSync(outputDir, { recursive: true });
  generateCmake(parsed, targetConfig, outputDir, fw);

  console.log(`\nDone! Output in: ${outputDir}`);
  console.log("Now build with one command:");
  console.log(`  cd ${outputDir}`);
  console.log("  cmake --build build");
  console.log("");
  console.log("Install Ninja first if not installed:");
  console.log("  winget install Ninja-build.Ninja");
}

main().catch(err => {
  console.error("Error:", err.message);
  process.exit(1);
});
