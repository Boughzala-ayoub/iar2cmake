# iar2cmake

Convert IAR EWARM projects to CMake/GCC projects for STM32.

Generates a `CMakeLists.txt`, `arm-none-eabi.cmake` toolchain file, `CMakePresets.json`, and `linker.ld` — all with CubeMX-style relative paths. Build with a single command.

## Requirements

- [ARM GCC toolchain](https://developer.arm.com/downloads/-/gnu-rm) (`arm-none-eabi-gcc` in PATH)
- [CMake](https://cmake.org/) ≥ 3.20
- [Ninja](https://ninja-build.org/) or MinGW Make
- Node.js ≥ 18

## Install

```bash
npm install -g iar2cmake
```

Or run directly:

```bash
npx iar2cmake <project.ewp> [options]
```

## Usage

```bash
iar2cmake <project.ewp> --fw-path <STM32Cube_FW_path> -o <output_dir>
```

Then build:

```bash
cd <output_dir>
cmake --build build
```

### Options

| Flag | Description |
|------|-------------|
| `-o, --out <dir>` | Output directory |
| `-c, --config <name>` | Build configuration to use |
| `--fw-path <dir>` | Path to STM32Cube FW pack (e.g., `STM32Cube_FW_F4`) |
| `--list-configs` | List available configurations and exit |
| `--verbose` | Print detailed info |
| `-h, --help` | Show help |

### Example

```bash
iar2cmake MyProject/EWARM/Project.ewp \
  --fw-path ~/STM32Cube/Repository/STM32Cube_FW_F4 \
  -o MyProject

cd MyProject
cmake --build build
```

## How it works

1. Parses the IAR `.ewp` XML to extract sources, includes, defines, MCU, linker script
2. Scans the STM32Cube FW pack to resolve HAL/CMSIS/Device/BSP headers and sources
3. Converts the IAR `.icf` linker script to a GCC `.ld` linker script
4. Replaces IAR startup assembly with the GCC startup file from the FW pack
5. Patches CMSIS `cmsis_gcc.h` for Cortex-M0 compatibility (if needed)
6. Generates `CMakeLists.txt` with relative paths, `arm-none-eabi.cmake` toolchain, and `CMakePresets.json`

## Supported MCUs

- STM32F0/G0 (Cortex-M0)
- STM32F1/L0/L1 (Cortex-M3)
- STM32F3/G4/L4/L5 (Cortex-M4 FPv4-SP-D16)
- STM32F4 (Cortex-M4 FPv4-SP-D16)
- STM32F7 (Cortex-M7 FPv5-D16)
- STM32H7 (Cortex-M7 FPv5-D16)
