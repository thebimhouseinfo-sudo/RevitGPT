import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd());

export function getAppDataRoot() {
  const raw = String(process.env.REVITGPT_APPDATA_ROOT || "").trim();
  const configured = raw.toLowerCase() === "appdata" ? "" : raw;
  if (configured) {
    const resolved = path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(REPO_ROOT, configured);
    const forbidden = path.resolve(REPO_ROOT, "appdata");
    const rel = path.relative(forbidden, resolved);
    if (resolved === forbidden || (rel && !rel.startsWith("..") && !path.isAbsolute(rel))) {
      throw new Error("REVITGPT_APPDATA_ROOT_REPO_LOCAL_FORBIDDEN");
    }
    return resolved;
  }
  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.resolve(process.env.LOCALAPPDATA, "RevitGPT");
  }
  return path.resolve(os.homedir(), ".local", "share", "RevitGPT");
}

export function appDataPath(area, ...parts) {
  return path.join(getAppDataRoot(), area, ...parts);
}
export const pythonLibrariesRoot = () => appDataPath("libraries","python");
export const dynamoLibrariesRoot = () => appDataPath("libraries","dynamo");
export const jobLibrariesRoot = () => appDataPath("libraries","jobs");
export const registryRoot = () => appDataPath("registry","user");
export const registryCapabilitiesPath = () => path.join(registryRoot(),"capabilities.json");
export const registryLibrariesPath = () => path.join(registryRoot(),"libraries.json");
export const pythonDraftRoot = () => appDataPath("workspace","python-draft");
export const dynamoDraftRoot = () => appDataPath("workspace","dynamo-draft");
export const jobDraftRoot = () => appDataPath("workspace","job-draft");
export const dynamicPythonRoot = () => appDataPath("runtime","dynamic-python");
export const runDataRoot = () => appDataPath("data","runs");
export const knowledgeRoot = () => appDataPath("knowledge");
export const logsRoot = () => appDataPath("logs");
export const stateRoot = () => appDataPath("state");

export async function ensureAppDataLayout() {
  const dirs=[
    getAppDataRoot(),
    pythonLibrariesRoot(),dynamoLibrariesRoot(),jobLibrariesRoot(),
    registryRoot(),
    pythonDraftRoot(),dynamoDraftRoot(),jobDraftRoot(),
    dynamicPythonRoot(),runDataRoot(),
    path.join(knowledgeRoot(),"revit"),
    path.join(knowledgeRoot(),"api"),
    path.join(knowledgeRoot(),"failures"),
    path.join(knowledgeRoot(),"learned"),
    logsRoot(),stateRoot()
  ];
  await Promise.all(dirs.map(d=>fs.mkdir(d,{recursive:true})));
  await ensureJson(registryCapabilitiesPath(),{version:1,entries:[]});
  await ensureJson(registryLibrariesPath(),{version:1,libraries:[]});
  await seedFile(path.join(REPO_ROOT,"knowledge","revit","WORKING_KNOWLEDGE.md"),path.join(knowledgeRoot(),"revit","WORKING_KNOWLEDGE.md"));
  await seedFile(path.join(REPO_ROOT,"knowledge","revit","SELF_IMPROVEMENT.md"),path.join(knowledgeRoot(),"revit","SELF_IMPROVEMENT.md"));
  await seedFile(path.join(REPO_ROOT,"knowledge","jobs","JOB_RULES.md"),path.join(knowledgeRoot(),"api","JOB_RULES.md"));
  await seedFile(path.join(REPO_ROOT,"diagnostics","revit","ERROR_LOG.md"),path.join(knowledgeRoot(),"failures","ERROR_LOG.md"));
}

async function ensureJson(target,value){
  try { await fs.access(target); } catch { await fs.writeFile(target,JSON.stringify(value,null,2)+"\n","utf8"); }
}

export function allowedManagedRoots(){
  return {
    libraries:getAppDataRoot()+path.sep+"libraries",
    registry:registryRoot(),
    workspace:getAppDataRoot()+path.sep+"workspace",
    runtime:getAppDataRoot()+path.sep+"runtime",
    data:runDataRoot(),
    knowledge:knowledgeRoot(),
    logs:logsRoot(),
    state:stateRoot()
  };
}


async function seedFile(source,target){
  try { await fs.access(target); return; } catch {}
  try {
    const content=await fs.readFile(source);
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(target,content,{flag:"wx"});
  } catch (error) {
    if (error?.code!=="EEXIST" && error?.code!=="ENOENT") throw error;
  }
}
