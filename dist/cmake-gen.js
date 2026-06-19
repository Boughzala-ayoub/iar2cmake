import * as fs from "fs";
import * as path from "path";
import { icf2ld } from "./icf2ld.js";
import { getHalSources, getGccStartupFile, getGccLinkerScript } from "./firmware.js";
const OPTIMIZATION_MAP = {
    "0": "-O0", "1": "-O1", "2": "-O2", "3": "-O3",
    "4": "-O3", "5": "-Os", "6": "-Oz", "7": "-O3",
};
function norm(p) {
    return p.replace(/\\/g, "/");
}
function rel(p, from) {
    const r = path.relative(from, p);
    return norm(r.startsWith("..") ? r : "./" + r);
}
export function generateCmake(proj, config, outputDir, fw) {
    const projectName = proj.projectName || path.basename(proj.projectDir);
    const opt = OPTIMIZATION_MAP[config.optimization] || "-O2";
    // Helper: resolve paths relative to FW pack if they don't exist
    function resolveInFwPack(p) {
        if (!fw)
            return p;
        const n = norm(p);
        if (fs.existsSync(n))
            return n;
        const idx = n.search(/[\\\/](Drivers|Middlewares)[\\\/]/i);
        if (idx !== -1) {
            const candidate = norm(path.join(fw.path, n.slice(idx + 1)));
            if (fs.existsSync(candidate))
                return candidate;
        }
        return n;
    }
    // Resolve includes + FW pack paths
    const incDirs = new Set();
    for (const inc of config.includes) {
        const resolved = resolveInFwPack(inc);
        if (fs.existsSync(resolved))
            incDirs.add(norm(resolved));
    }
    if (fw) {
        if (fw.halIncPath && fs.existsSync(fw.halIncPath))
            incDirs.add(norm(fw.halIncPath));
        if (fw.cmsisCoreIncPath && fs.existsSync(fw.cmsisCoreIncPath))
            incDirs.add(norm(fw.cmsisCoreIncPath));
        if (fw.cmsisDeviceIncPath && fs.existsSync(fw.cmsisDeviceIncPath))
            incDirs.add(norm(fw.cmsisDeviceIncPath));
        // Add BSP include dirs from FW pack
        const bspDir = path.join(fw.path, "Drivers", "BSP");
        if (fs.existsSync(bspDir)) {
            for (const sub of fs.readdirSync(bspDir)) {
                const bspInc = path.join(bspDir, sub);
                if (fs.statSync(bspInc).isDirectory())
                    incDirs.add(norm(bspInc));
            }
        }
    }
    // Relative includes
    const relIncludes = [...incDirs].map(d => `  ${rel(d, outputDir)}`).join("\n");
    // User sources (exclude .icf)
    const userSources = config.sources.filter(s => !s.match(/\.icf$/i)).map(norm);
    // Replace IAR startup with GCC startup from FW pack
    const finalSources = [];
    let startupReplaced = false;
    for (const src of userSources) {
        const isStartup = /startup_.*\.s$/i.test(path.basename(src)) || /cstartup\.s$/i.test(src);
        if (isStartup && fw) {
            const gccStartup = getGccStartupFile(fw, config.device);
            if (gccStartup) {
                // Copy startup file locally (CubeMX-style)
                const localStartup = path.join(outputDir, path.basename(gccStartup));
                fs.copyFileSync(gccStartup, localStartup);
                finalSources.push(norm(localStartup));
                startupReplaced = true;
                continue;
            }
        }
        finalSources.push(resolveInFwPack(src));
    }
    if (!startupReplaced && fw) {
        const gccStartup = getGccStartupFile(fw, config.device);
        if (gccStartup) {
            const localStartup = path.join(outputDir, path.basename(gccStartup));
            fs.copyFileSync(gccStartup, localStartup);
            finalSources.push(norm(localStartup));
        }
    }
    // Add HAL sources from FW pack (deduplicate against already-listed sources)
    if (fw) {
        const existing = new Set(finalSources.map(s => path.basename(s).toLowerCase()));
        const halSrcs = getHalSources(fw, config.device)
            .map(norm)
            .filter(s => !existing.has(path.basename(s).toLowerCase()));
        finalSources.push(...halSrcs);
    }
    const defines = config.defines.map(d => `  ${d}`).join("\n");
    const relSources = finalSources.map(s => `  ${rel(s, outputDir)}`).join("\n");
    // MCU flags: detect from device name
    let mcpu = "cortex-m4";
    let mfloat = "mfloat-abi=hard -mfpu=fpv4-sp-d16";
    if (/STM32F0/i.test(config.device) || /STM32G0/i.test(config.device)) {
        mcpu = "cortex-m0";
        mfloat = "";
    }
    else if (/STM32F1/i.test(config.device) || /STM32L0/i.test(config.device) || /STM32L1/i.test(config.device)) {
        mcpu = "cortex-m3";
        mfloat = "";
    }
    else if (/STM32F3/i.test(config.device)) {
        mcpu = "cortex-m4";
        mfloat = "mfloat-abi=hard -mfpu=fpv4-sp-d16";
    }
    else if (/STM32F4/i.test(config.device)) {
        mcpu = "cortex-m4";
        mfloat = "mfloat-abi=hard -mfpu=fpv4-sp-d16";
    }
    else if (/STM32F7/i.test(config.device)) {
        mcpu = "cortex-m7";
        mfloat = "mfloat-abi=hard -mfpu=fpv5-d16";
    }
    else if (/STM32H7/i.test(config.device)) {
        mcpu = "cortex-m7";
        mfloat = "mfloat-abi=hard -mfpu=fpv5-d16";
    }
    else if (/STM32G4/i.test(config.device) || /STM32L4/i.test(config.device) || /STM32L5/i.test(config.device)) {
        mcpu = "cortex-m4";
        mfloat = "mfloat-abi=hard -mfpu=fpv4-sp-d16";
    }
    const floatFlags = mfloat ? `-${mfloat}` : "";
    const cFlags = `${opt} -g -Wall -Wextra -Wno-unused-parameter -Wno-pedantic -mcpu=${mcpu} -mthumb ${floatFlags} -ffunction-sections -fdata-sections -MMD -MP`.trim();
    // Resolve linker script
    let ldSource = "";
    if (fw) {
        const fwLd = getGccLinkerScript(fw, config.device);
        if (fwLd) {
            fs.copyFileSync(fwLd, path.join(outputDir, "linker.ld"));
            ldSource = "firmware pack";
        }
    }
    if (!ldSource && config.icfFile && fs.existsSync(config.icfFile)) {
        const icfContent = fs.readFileSync(config.icfFile, "utf-8");
        icf2ld(icfContent, path.join(outputDir, "linker.ld"));
        ldSource = "converted .icf";
    }
    if (!ldSource) {
        const devUpper = config.device.toUpperCase();
        let flashSize = "2M";
        let ramSize = "192K";
        if (/STM32F0/.test(devUpper) || /STM32G0/.test(devUpper)) {
            flashSize = "64K";
            ramSize = "8K";
        }
        else if (/STM32F1/.test(devUpper)) {
            flashSize = "512K";
            ramSize = "64K";
        }
        else if (/STM32G4/.test(devUpper)) {
            flashSize = "512K";
            ramSize = "128K";
        }
        else if (/STM32L4/.test(devUpper)) {
            flashSize = "1M";
            ramSize = "128K";
        }
        else if (/STM32H7/.test(devUpper)) {
            flashSize = "2M";
            ramSize = "512K";
        }
        else if (/STM32F7/.test(devUpper)) {
            flashSize = "1M";
            ramSize = "320K";
        }
        const ld = `MEMORY {
  FLASH (rx)  : ORIGIN = 0x08000000, LENGTH = ${flashSize}
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = ${ramSize}
}
_estack = ORIGIN(RAM) + LENGTH(RAM);
SECTIONS {
  .isr_vector : { KEEP(*(.isr_vector)) } > FLASH
  .text : { *(.text*) *(.rodata*) . = ALIGN(4); _etext = .; } > FLASH
  .data : { _sdata = .; *(.data*) . = ALIGN(4); _edata = .; _sidata = LOADADDR(.data); } > RAM AT > FLASH
  .bss : { _sbss = .; *(.bss*) *(COMMON) . = ALIGN(4); _ebss = .; } > RAM
}`;
        fs.writeFileSync(path.join(outputDir, "linker.ld"), ld, "utf-8");
        ldSource = "estimated";
    }
    const toolchainFile = `# ARM GCC toolchain file for STM32
set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(CMAKE_C_COMPILER arm-none-eabi-gcc)
set(CMAKE_ASM_COMPILER arm-none-eabi-gcc)
set(CMAKE_OBJCOPY arm-none-eabi-objcopy)
set(CMAKE_SIZE arm-none-eabi-size)

set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# Skip compiler sanity check (required for cross-compilation)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# Try to find Ninja or Make to avoid NMake dependency
if(CMAKE_HOST_WIN32)
  find_program(CMAKE_MAKE_PROGRAM ninja PATHS ENV PATH)
  if(NOT CMAKE_MAKE_PROGRAM)
    find_program(CMAKE_MAKE_PROGRAM mingw32-make PATHS ENV PATH)
  endif()
endif()
`;
    const cmake = `cmake_minimum_required(VERSION 3.20)
project(${projectName} C ASM)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

set(CMAKE_C_FLAGS "${cFlags}" CACHE STRING "" FORCE)
set(CMAKE_EXE_LINKER_FLAGS "-Wl,--gc-sections,--print-memory-usage -specs=nano.specs -specs=nosys.specs -T\${CMAKE_SOURCE_DIR}/linker.ld" CACHE STRING "" FORCE)

target_compile_definitions(\${PROJECT_NAME}.elf PRIVATE
${defines}
)

include_directories(
${relIncludes}
)

add_executable(\${PROJECT_NAME}.elf
${relSources}
)
`;
    const presetJson = `{
  "version": 6,
  "configurePresets": [
    {
      "name": "default",
      "displayName": "Default",
      "generator": "Ninja",
      "toolchainFile": "\${sourceDir}/arm-none-eabi.cmake",
      "binaryDir": "\${sourceDir}/build"
    }
  ],
  "buildPresets": [
    {
      "name": "default",
      "configurePreset": "default"
    }
  ]
}
`;
    fs.writeFileSync(path.join(outputDir, "CMakeLists.txt"), cmake, "utf-8");
    fs.writeFileSync(path.join(outputDir, "arm-none-eabi.cmake"), toolchainFile, "utf-8");
    fs.writeFileSync(path.join(outputDir, "CMakePresets.json"), presetJson, "utf-8");
    console.log(`\nGenerated CMakeLists.txt + arm-none-eabi.cmake`);
    console.log(`Config: ${config.name}`);
    console.log(`Device: ${config.device} (CPU: ${mcpu})`);
    console.log(`Optimization: ${opt}`);
    console.log(`User sources: ${userSources.length}`);
    console.log(`HAL sources: ${fw ? getHalSources(fw, config.device).length : 0}`);
    console.log(`Linker script: ${ldSource}`);
}
