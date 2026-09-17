interface GhostscriptModule {
  FS: {writeFile(path:string,data:Uint8Array):void;readFile(path:string,options?:{encoding:'binary'}):Uint8Array};
  callMain(args:string[]):number;
}
export default function load(options:{wasmBinary:Uint8Array;locateFile:(file:string)=>string;print:(text:string)=>void;printErr:(text:string)=>void}):Promise<GhostscriptModule>;
