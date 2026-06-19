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
export declare function scanFirmwarePack(fwPath: string, device: string): FirmwarePack | null;
export declare function getHalSources(fw: FirmwarePack, mcuDef: string): string[];
export declare function getGccStartupFile(fw: FirmwarePack, device: string): string | null;
export declare function getGccLinkerScript(fw: FirmwarePack, device: string): string | null;
