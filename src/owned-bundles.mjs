import fs from "node:fs/promises";
import path from "node:path";
import { dynamoLibrariesRoot, jobLibrariesRoot, tempJobsRoot, modelAnchorsRoot } from "./appdata.mjs";

const SEGMENT=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const kinds={
  job:jobLibrariesRoot,
  dynamo:dynamoLibrariesRoot,
  temp:tempJobsRoot,
  model:modelAnchorsRoot
};

function segment(value){
  if(typeof value!=="string"||!SEGMENT.test(value)||value==="."||value==="..")
    throw new Error("OWNED_BUNDLE_INVALID_ID");
  return value;
}
function descendant(root,file){
  const rel=path.relative(root,file);
  return Boolean(rel)&&rel!==".."&&!rel.startsWith(".."+path.sep)&&!path.isAbsolute(rel);
}
function relativeFile(value){
  if(typeof value!=="string"||!value||path.isAbsolute(value))throw new Error("OWNED_FILE_RELATIVE_PATH_REQUIRED");
  const parts=value.split(/[\\/]/);
  if(parts.some(x=>!x||x==="."||x===".."||x.includes(":")))throw new Error("OWNED_FILE_INVALID_PATH");
  return parts.join(path.sep);
}
async function safePath(root,relative,allowMissing=false){
  const rootStat=await fs.lstat(root);
  if(rootStat.isSymbolicLink())throw new Error("OWNED_BUNDLE_ROOT_LINK_DENIED");
  const realRoot=await fs.realpath(root);
  const target=path.resolve(root,relative);
  if(!descendant(root,target))throw new Error("OWNED_FILE_OUTSIDE_BUNDLE");
  let current=root;
  for(const part of path.relative(root,target).split(path.sep)){
    current=path.join(current,part);
    let st;
    try{st=await fs.lstat(current);}catch(e){
      if(e.code==="ENOENT"&&allowMissing)continue;
      throw e;
    }
    if(st.isSymbolicLink())throw new Error("OWNED_FILE_SYMLINK_DENIED");
  }
  if(!descendant(realRoot,path.resolve(realRoot,relative)))throw new Error("OWNED_FILE_ESCAPES_BUNDLE");
  return target;
}
export function ownedBundleRoot(kind,id){
  const factory=kinds[kind];
  if(!factory)throw new Error("OWNED_BUNDLE_KIND_UNKNOWN");
  return path.join(factory(),segment(id));
}
export async function createOwnedBundle(kind,id){
  const root=ownedBundleRoot(kind,id);
  await fs.mkdir(path.dirname(root),{recursive:true});
  try{await fs.mkdir(root);}catch(e){if(e.code==="EEXIST")throw new Error("OWNED_BUNDLE_EXISTS");throw e;}
  return root;
}
export async function readOwnedFile(kind,id,file){
  const root=ownedBundleRoot(kind,id),name=relativeFile(file);
  return fs.readFile(await safePath(root,name),"utf8");
}
export async function writeOwnedFile(kind,id,file,content,{expectedContent}={}){
  const root=ownedBundleRoot(kind,id),name=relativeFile(file);
  if(typeof content!=="string")throw new Error("OWNED_FILE_TEXT_REQUIRED");
  const target=await safePath(root,name,true);
  if(expectedContent!==undefined){
    const before=await fs.readFile(target,"utf8");
    if(before!==expectedContent)throw new Error("OWNED_FILE_CONTENT_CHANGED");
  }else{
    try{await fs.lstat(target);throw new Error("OWNED_FILE_ALREADY_EXISTS");}
    catch(e){if(e.message==="OWNED_FILE_ALREADY_EXISTS")throw e;if(e.code!=="ENOENT")throw e;}
  }
  await fs.mkdir(path.dirname(target),{recursive:true});
  const checked=await safePath(root,name,true);
  await fs.writeFile(checked,content,{flag:expectedContent===undefined?"wx":"w"});
  return checked;
}
