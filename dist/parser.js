import { XMLParser } from "fast-xml-parser";
import * as fs from "fs";
import * as path from "path";
function getText(val) {
    if (Array.isArray(val))
        return val[0] ?? "";
    if (typeof val === "string")
        return val;
    return "";
}
function ensureArray(val) {
    if (Array.isArray(val))
        return val;
    if (val == null)
        return [];
    return [val];
}
function normalizePath(path, projectDir) {
    return path.replace(/\$PROJ_DIR\$/gi, projectDir).replace(/\\/g, "/");
}
function isPathLike(s) {
    return /^(\$PROJ_DIR\$|[A-Z]:|\.\.?[\\/])/.test(s) || /\.\w+$/.test(s);
}
function collectFiles(node, projectDir) {
    const files = [];
    if (!node)
        return files;
    if (Array.isArray(node)) {
        for (const item of node)
            files.push(...collectFiles(item, projectDir));
        return files;
    }
    // Only add as file if name is a path, not a group label
    if (typeof node.name === "string" && isPathLike(node.name)) {
        files.push(normalizePath(node.name, projectDir));
    }
    if (node.group) {
        files.push(...collectFiles(node.group, projectDir));
    }
    if (node.file) {
        files.push(...collectFiles(node.file, projectDir));
    }
    return files;
}
export function parseEwp(ewpPath, projectDir) {
    const xml = fs.readFileSync(ewpPath, "utf-8");
    const parser = new XMLParser({
        ignoreAttributes: false,
        isArray: (name) => ["configuration", "file", "group", "option", "state"].includes(name),
    });
    const doc = parser.parse(xml);
    const proj = doc.project;
    if (!proj)
        throw new Error("Invalid .ewp file: no <project> root");
    const dir = projectDir || path.dirname(ewpPath);
    const configs = [];
    const rawConfigs = ensureArray(proj.configuration);
    for (const cfg of rawConfigs) {
        const name = getText(cfg.name) || "Default";
        let device = "";
        let icfFile = "";
        const defines = [];
        const includes = [];
        let optimization = "0";
        const settings = ensureArray(cfg.settings);
        for (const setting of settings) {
            const sName = getText(setting.name);
            if (!sName)
                continue;
            const sNameUpper = sName.toUpperCase();
            if (sNameUpper === "GENERAL") {
                const general = setting.data?.general || setting.data?.device;
                if (general?.device?.name)
                    device = general.device.name;
                const opts = ensureArray(setting.data?.option);
                for (const opt of opts) {
                    const n = getText(opt.name);
                    if (n === "OCDDFTarget")
                        device = getText(opt.state);
                    if (n === "OGChipSelectEditMenu") {
                        // Format: "STM32F072VB\tST STM32F072VB"
                        const val = getText(opt.state);
                        const mcuMatch = val.match(/^(\w+)/);
                        if (mcuMatch)
                            device = mcuMatch[1];
                    }
                }
            }
            if (sNameUpper === "ICCARM") {
                const opts = ensureArray(setting.data?.option);
                for (const opt of opts) {
                    const name = getText(opt.name);
                    if (name === "CCDefines") {
                        const vals = ensureArray(opt.state);
                        for (const v of vals) {
                            const s = getText(v);
                            if (s && s !== "0")
                                defines.push(s);
                        }
                    }
                    if (name === "CCIncludePath2") {
                        const vals = ensureArray(opt.state);
                        for (const v of vals) {
                            const s = getText(v);
                            if (s && s !== "0")
                                includes.push(normalizePath(s, dir));
                        }
                    }
                    if (name === "CCOptimizationLevel" || name === "CCOptLevel") {
                        optimization = getText(opt.state);
                    }
                }
            }
            if (sNameUpper === "ILINK") {
                const opts = ensureArray(setting.data?.option);
                for (const opt of opts) {
                    if (getText(opt.name) === "IlinkIcfFile")
                        icfFile = normalizePath(getText(opt.state), dir);
                }
            }
        }
        configs.push({ name, device, sources: [], includes, defines, optimization, icfFile });
    }
    // Only keep compilable source files
    const allFiles = collectFiles(proj.group || proj.file, dir)
        .filter(f => /\.(c|cc|cpp|s|S|asm)$/i.test(f));
    for (const cfg of configs) {
        cfg.sources = allFiles;
    }
    const projectName = path.basename(ewpPath).replace(/\.ewp$/i, "");
    return { configs, projectDir: dir, projectName };
}
