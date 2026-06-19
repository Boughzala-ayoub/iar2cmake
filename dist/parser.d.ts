export interface ProjectConfig {
    name: string;
    device: string;
    sources: string[];
    includes: string[];
    defines: string[];
    optimization: string;
    icfFile: string;
}
export interface ParsedProject {
    configs: ProjectConfig[];
    projectDir: string;
    projectName: string;
}
export declare function parseEwp(ewpPath: string, projectDir?: string): ParsedProject;
