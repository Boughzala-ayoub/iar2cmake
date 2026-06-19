import * as fs from "fs";
import * as path from "path";

export interface FirmwarePack {
  path: string;
  mcuSeries: string;
  halPath: string;
  halIncPath: string;
  cmsisCoreIncPath: string;
  cmsisDeviceIncPath: string;
  startupDir: string;
  linkerDir: string;
}

function patchCmsisGcc(cmsisIncludeDir: string): void {
  const gccPath = path.join(cmsisIncludeDir, "cmsis_gcc.h");
  const bakPath = gccPath + ".orig";
  if (!fs.existsSync(gccPath) || fs.existsSync(bakPath)) return;
  const content = fs.readFileSync(gccPath, "utf-8");

  // Add __ARM_ARCH_6M__ checks to __DSB, __DMB, __ISB
  let patched = content;
  
  // Patch __DSB: on M0 use plain dsb
  patched = patched.replace(
    /(^__STATIC_FORCEINLINE void __DSB\(void\)\s*\{)([\s\S]*?)(^\})/m,
    (match, header) => {
      return `${header}
#if defined(__ARM_ARCH_6M__)
  __ASM volatile ("dsb":::"memory");
#else
  __ASM volatile ("dsb 0xF":::"memory");
#endif
}`;
    }
  );

  // Patch __DMB: on M0 use plain dmb
  patched = patched.replace(
    /(^__STATIC_FORCEINLINE void __DMB\(void\)\s*\{)([\s\S]*?)(^\})/m,
    (match, header) => {
      return `${header}
#if defined(__ARM_ARCH_6M__)
  __ASM volatile ("dmb":::"memory");
#else
  __ASM volatile ("dmb 0xF":::"memory");
#endif
}`;
    }
  );

  // Patch __ISB: on M0 use plain isb
  patched = patched.replace(
    /(^__STATIC_FORCEINLINE void __ISB\(void\)\s*\{)([\s\S]*?)(^\})/m,
    (match, header) => {
      return `${header}
#if defined(__ARM_ARCH_6M__)
  __ASM volatile ("isb":::"memory");
#else
  __ASM volatile ("isb 0xF":::"memory");
#endif
}`;
    }
  );

  if (patched === content) return; // no changes
  fs.copyFileSync(gccPath, bakPath);
  fs.writeFileSync(gccPath, patched, "utf-8");
  console.log(`  Patched cmsis_gcc.h for M0 compatibility (backup: cmsis_gcc.h.orig)`);
}

const MCU_SERIES_MAP: Record<string, string> = {
  STM32F0: "STM32F0xx_HAL_Driver",
  STM32F1: "STM32F1xx_HAL_Driver",
  STM32F2: "STM32F2xx_HAL_Driver",
  STM32F3: "STM32F3xx_HAL_Driver",
  STM32F4: "STM32F4xx_HAL_Driver",
  STM32F7: "STM32F7xx_HAL_Driver",
  STM32G0: "STM32G0xx_HAL_Driver",
  STM32G4: "STM32G4xx_HAL_Driver",
  STM32H5: "STM32H5xx_HAL_Driver",
  STM32H7: "STM32H7xx_HAL_Driver",
  STM32L0: "STM32L0xx_HAL_Driver",
  STM32L1: "STM32L1xx_HAL_Driver",
  STM32L4: "STM32L4xx_HAL_Driver",
  STM32L5: "STM32L5xx_HAL_Driver",
  STM32U5: "STM32U5xx_HAL_Driver",
  STM32WB: "STM32WBxx_HAL_Driver",
  STM32WL: "STM32WLxx_HAL_Driver",
};

function detectSeries(device: string): string | null {
  const upper = device.toUpperCase();
  for (const [series] of Object.entries(MCU_SERIES_MAP)) {
    if (upper.startsWith(series)) return series;
  }
  // Try common prefixes
  const match = upper.match(/^(STM32[FA-GHLMUW][0-9])/);
  if (match) {
    for (const [series] of Object.entries(MCU_SERIES_MAP)) {
      if (match[1].startsWith(series.replace(/xx$/, "").replace(/_\w+$/, ""))) return series;
    }
  }
  return null;
}

function findFwPack(fwPath: string, series: string): string | null {
  // Check if direct drivers path exists
  const halDir = MCU_SERIES_MAP[series];
  if (!halDir) return null;

  const driversPath = path.join(fwPath, "Drivers");
  if (!fs.existsSync(driversPath)) {
    // Maybe fwPath is the pack root, check subdirs
    const entries = fs.readdirSync(fwPath);
    for (const entry of entries) {
      const sub = path.join(fwPath, entry);
      if (fs.statSync(sub).isDirectory()) {
        const subDrivers = path.join(sub, "Drivers");
        if (fs.existsSync(subDrivers)) {
          return sub;
        }
      }
    }
    return null;
  }
  return fwPath;
}

export function scanFirmwarePack(fwPath: string, device: string): FirmwarePack | null {
  const series = detectSeries(device);
  if (!series) return null;

  const packRoot = findFwPack(fwPath, series);
  if (!packRoot) return null;

  const halDirName = MCU_SERIES_MAP[series];
  const halPath = path.join(packRoot, "Drivers", halDirName);
  const halIncPath = path.join(halPath, "Inc");
  const halSrcPath = path.join(halPath, "Src");

  if (!fs.existsSync(halIncPath)) return null;

  const cmsisCoreIncPath = path.join(packRoot, "Drivers", "CMSIS", "Include");
  const cmsisDeviceIncBase = path.join(packRoot, "Drivers", "CMSIS", "Device");

  // Find device-specific CMSIS dir
  let cmsisDeviceIncPath = "";
  let startupDir = "";
  let linkerDir = "";

  if (fs.existsSync(cmsisDeviceIncBase)) {
    const stDir = path.join(cmsisDeviceIncBase, "ST");
    if (fs.existsSync(stDir)) {
      const mcuDirs = fs.readdirSync(stDir);
      for (const mcuDir of mcuDirs) {
        const candidateInc = path.join(stDir, mcuDir, "Include");
        if (fs.existsSync(candidateInc)) {
          cmsisDeviceIncPath = candidateInc;
          const templatesGcc = path.join(stDir, mcuDir, "Source", "Templates", "gcc");
          if (fs.existsSync(templatesGcc)) {
            startupDir = templatesGcc;
            linkerDir = templatesGcc;
          }
          break;
        }
      }
    }
  }

  // Patch cmsis_gcc.h for Cortex-M0 dsb/dmb/isb compatibility
  patchCmsisGcc(cmsisCoreIncPath);

  return {
    path: packRoot,
    mcuSeries: series,
    halPath,
    halIncPath,
    cmsisCoreIncPath,
    cmsisDeviceIncPath,
    startupDir,
    linkerDir,
  };
}

export function getHalSources(fw: FirmwarePack, mcuDef: string): string[] {
  const srcDir = path.join(fw.halPath, "Src");
  if (!fs.existsSync(srcDir)) return [];

  return fs.readdirSync(srcDir)
    .filter(f => f.endsWith(".c") && !f.includes("_template."))
    .map(f => path.join(srcDir, f));
}

export function getGccStartupFile(fw: FirmwarePack, device: string): string | null {
  if (!fw.startupDir || !fs.existsSync(fw.startupDir)) return null;

  const files = fs.readdirSync(fw.startupDir);
  const devLower = device.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Extract base device number (e.g., "stm32f072" from "stm32f072rb")
  const devMatch = devLower.match(/^(stm32[a-z]\d+)/);

  // Try exact match first: startup file base is contained in device name
  let candidates = files.filter(f => {
    if (!/^startup_.*\.s$/i.test(f)) return false;
    const fBase = f.replace(/^startup_/i, "").replace(/\.s$/i, "").toLowerCase();
    return devLower.includes(fBase);
  });
  if (candidates.length > 0) return path.join(fw.startupDir, candidates[0]);

  // Try prefix match: startup base starts with device numeric prefix
  if (devMatch) {
    candidates = files.filter(f => {
      if (!/^startup_.*\.s$/i.test(f)) return false;
      const fBase = f.replace(/^startup_/i, "").replace(/\.s$/i, "").toLowerCase();
      return fBase.startsWith(devMatch[1]);
    });
    if (candidates.length > 0) return path.join(fw.startupDir, candidates[0]);
  }

  // Fallback: first startup file
  const startupFiles = files.filter(f => /^startup_.*\.s$/i.test(f));
  return startupFiles.length > 0 ? path.join(fw.startupDir, startupFiles[0]) : null;
}

export function getGccLinkerScript(fw: FirmwarePack, device: string): string | null {
  if (!fw.linkerDir || !fs.existsSync(fw.linkerDir)) return null;

  const files = fs.readdirSync(fw.linkerDir);
  const devUpper = device.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Extract base device number (e.g., "STM32F072" from "STM32F072RB")
  const devMatch = devUpper.match(/^(STM32[A-Z]\d+)/);

  // Try exact match first: linker base is contained in device name
  let candidates = files.filter(f => {
    if (!f.endsWith(".ld")) return false;
    const fBase = f.replace(/_.*\.ld$/i, "").replace(/[^A-Z0-9]/g, "");
    return devUpper.includes(fBase);
  });

  if (candidates.length === 0 && devMatch) {
    // Try prefix match: linker base starts with device numeric prefix
    candidates = files.filter(f => {
      if (!f.endsWith(".ld")) return false;
      const fBase = f.replace(/_.*\.ld$/i, "").replace(/[^A-Z0-9]/g, "");
      return fBase.startsWith(devMatch[1]);
    });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => ((b.match(/_/g) || []).length) - ((a.match(/_/g) || []).length));
    return path.join(fw.linkerDir, candidates[0]);
  }

  // Fallback: any .ld file
  const ldFiles = files.filter(f => f.endsWith(".ld"));
  return ldFiles.length > 0 ? path.join(fw.linkerDir, ldFiles[0]) : null;
}
