import { FirmwarePack } from "./firmware.js";
import { ProjectConfig, ParsedProject } from "./parser.js";
export declare function generateCmake(proj: ParsedProject, config: ProjectConfig, outputDir: string, fw?: FirmwarePack): void;
