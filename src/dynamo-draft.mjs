// Builder-side Dynamo .dyn validation and immutable native-runtime staging.
// Graph construction is authored in a managed workspace draft; Revit/Dynamo
// are never invoked by this module.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const MAX_BYTES=2*1024*1024;
const UNSAFE=["pythonscript","pythonnode","scriptevaluator",
              "process.start","system.io","file.write","webrequest"];
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");

export function validateDynamoDraft(content){
  const bytes=Buffer.byteLength(content,"utf8");
  if(bytes===0 || bytes>MAX_BYTES)throw new Error("DYN_INVALID_SIZE");
  let graph;
  try{graph=JSON.parse(content);}catch{throw new Error("DYN_INVALID_JSON");}
  if(!graph || Array.isArray(graph) || !Array.isArray(graph.Nodes) ||
     !Array.isArray(graph.Connectors) || graph.Nodes.length<1 ||
     graph.Nodes.length>1000 || graph.Connectors.length>4000)
    throw new Error("DYN_INVALID_GRAPH_STRUCTURE");
  const ids=new Set(), inputPorts=new Set(), outputPorts=new Set(), allPorts=new Set();
  for(const node of graph.Nodes){
    if(!node || typeof node!=="object" || Array.isArray(node) ||
       typeof node.Id!=="string" || !node.Id.trim() || ids.has(node.Id))
      throw new Error("DYN_INVALID_OR_DUPLICATE_NODE_ID");
    ids.add(node.Id);
    for(const [key,store] of [["Inputs",inputPorts],["Outputs",outputPorts]]){
      if(!Array.isArray(node[key]))throw new Error("DYN_PORT_LIST_MISSING");
      for(const port of node[key]){
        if(!port || typeof port.Id!=="string" || !port.Id.trim() || allPorts.has(port.Id))
          throw new Error("DYN_INVALID_OR_DUPLICATE_PORT_ID");
        store.add(port.Id);
        allPorts.add(port.Id);
      }
    }
    const identity=["NodeType","ConcreteType","Name","FunctionSignature","Code"]
      .map(k=>String(node[k]??"")).join(" ").toLowerCase();
    if(UNSAFE.some(key=>identity.includes(key)))
      throw new Error("DYN_UNREVIEWED_EXECUTABLE_NODE");
    // Official DynamoDS graph samples use DynamoCore ZeroTouch functions
    // and DesignScript CodeBlock nodes; rejecting either disables routine
    // graph authoring. Unknown executable assemblies remain unreviewed.
    if(identity.includes("zerotouch") &&
       (!String(node.ConcreteType??"").trim().endsWith(", DynamoCore") ||
        typeof node.FunctionSignature!=="string" || !node.FunctionSignature.trim()))
      throw new Error("DYN_UNREVIEWED_ZEROTOUCH");

  }
  const links=new Set(), connectorIds=new Set();
  for(const edge of graph.Connectors){
    if(!edge || typeof edge!=="object" || Array.isArray(edge) ||
      !outputPorts.has(edge.Start) || !inputPorts.has(edge.End) ||
      typeof edge.Id!=="string" || !edge.Id.trim() || connectorIds.has(edge.Id) ||
      (edge.StartIndex!==undefined && (!Number.isSafeInteger(edge.StartIndex)||edge.StartIndex<0)) ||
      (edge.EndIndex!==undefined && (!Number.isSafeInteger(edge.EndIndex)||edge.EndIndex<0)))
      throw new Error("DYN_INVALID_CONNECTOR");
    connectorIds.add(edge.Id);
    const key=[edge.Start,edge.End].join(":");
    if(links.has(key))throw new Error("DYN_DUPLICATE_CONNECTOR");
    links.add(key);
  }
  return {status:"STATIC_VALIDATION_ONLY",sha256:hash(Buffer.from(content,"utf8")),
    nodes:ids.size,connectors:links.size,host_compatibility_verified:false,
    execution_requested:false};
}

async function requireManagedDraft(root,source){
  const base=path.resolve(root),target=path.resolve(source),rel=path.relative(base,target);
  if(!rel || rel.startsWith("..") || path.isAbsolute(rel) || path.extname(target).toLowerCase()!==".dyn")
    throw new Error("DYN_DRAFT_OUTSIDE_WORKSPACE");
  let dir=base;
  for(const part of rel.split(path.sep)){
    dir=path.join(dir,part);
    const st=await fs.lstat(dir);
    if(st.isSymbolicLink() || (typeof st.isSymbolicLink==="function" && !st.isFile() && !st.isDirectory()))
      throw new Error("DYN_DRAFT_LINK_REJECTED");
  }
  if(!((await fs.lstat(target)).isFile()))throw new Error("DYN_DRAFT_NOT_FILE");
  const actualBase=await fs.realpath(base), actual=await fs.realpath(target);
  if(!actual.startsWith(actualBase+path.sep))throw new Error("DYN_DRAFT_ESCAPES_ROOT");
  return actual;
}

export async function validateDynamoDraftFile(root,source){
  const file=await requireManagedDraft(root,source);
  const bytes=await fs.readFile(file);
  return {...validateDynamoDraft(bytes.toString("utf8")),draft_path:file};
}

export async function stageDynamoDraft(root,staging,source,expectedSha256){
  if(!/^[a-f0-9]{64}$/i.test(expectedSha256||""))
    throw new Error("DYN_SHA_REQUIRED");
  const file=await requireManagedDraft(root,source);
  const bytes=await fs.readFile(file);
  const report=validateDynamoDraft(bytes.toString("utf8"));
  if(report.sha256!==expectedSha256.toLowerCase())throw new Error("DYN_SHA_MISMATCH");
  await fs.mkdir(staging,{recursive:true});
  const stat=await fs.lstat(staging);
  if(stat.isSymbolicLink())throw new Error("DYN_STAGE_SYMLINK");
  const destination=path.join(staging,report.sha256+".dyn");
  try{await fs.writeFile(destination,bytes,{flag:"wx"});}
  catch(error){
    if(error.code!=="EEXIST")throw error;
    if(hash(await fs.readFile(destination))!==report.sha256)
      throw new Error("DYN_STAGE_CONTENT_CONFLICT");
  }
  return {...report,status:"STAGED_NOT_EXECUTED",stage_path:destination};
}
