type ExportedBoard={nodeId:string;sourceId:string;name:string;path:string;width:number;height:number;bytes:Uint8Array};
/** Export each original artboard independently, with identifiers for reference matching. */
export async function exportValidation(rootId:string,progress:(done:number,total:number)=>void){
  const root=await figma.getNodeByIdAsync(rootId);
  if(!root||root.type!=='FRAME')throw new Error('导入根节点已删除或不再是画板');
  const candidates=root.findAll(n=>n.type==='FRAME'&&n.getPluginData('import:artboard')==='true');
  // Nested artboards inside a smart object belong to that object's appearance.
  const boards=candidates.filter(n=>{let p=n.parent;while(p&&p.id!==root.id){if(candidates.some(b=>b.id===p!.id))return false;p=p.parent;}return true;});
  if(!boards.length)boards.push(root);
  const rendered:ExportedBoard[]=[];
  for(let i=0;i<boards.length;i++){
    const board=boards[i];progress(i,boards.length);
    let sourceId='';try{sourceId=JSON.parse(board.getPluginData('import:source')).id||'';}catch{}
    const bytes=await board.exportAsync({format:'PNG',constraint:{type:'SCALE',value:1},useAbsoluteBounds:true});
    rendered.push({nodeId:board.id,sourceId,name:board.name,path:'renders/artboard-'+(i+1)+'.png',width:board.width,height:board.height,bytes});
  }
  const geometry=root.findAll(n=>!!n.getPluginData('import:source')).map(n=>{
    let source:Record<string,string>={};try{source=JSON.parse(n.getPluginData('import:source'));}catch{}
    const b=n.absoluteBoundingBox;
    return{nodeId:n.id,sourceId:source.id,sourceType:source.type,name:n.name,visible:n.visible,
      recovery:n.getPluginData('import:recovery')==='true',fidelity:n.getPluginData('import:fidelity'),
      bounds:b?{x:b.x-root.x,y:b.y-root.y,width:b.width,height:b.height}:null};
  });
  progress(boards.length,boards.length);
  return{rendered,geometry,fidelityValidated:false};
}
