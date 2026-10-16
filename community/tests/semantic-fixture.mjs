// Public, generated regression fixture. No private document content.
export function semanticPdf({artifact=true,tagged=true,paintingFont=false,partial=false,decor=true,newlines=false}={}){
 const drawing=partial?'21 50 8 14 re f':'21 50 8 14 re 33 50 8 14 re'+(newlines?' 21 25 8 14 re 33 25 8 14 re':'')+' f';
 const artwork=(artifact?'/Artifact BMC ':'')+'0.1 0.2 0.3 rg '+drawing+(decor?' 1 0 0 rg 22 54 1 1 re f':'')+(artifact?' EMC':'');
 const content=artwork+' 0 0 0 rg '+(tagged?'/Span <</MCID 0>> BDC ':'')+'BT /F1 20 Tf 1 0 0 1 20 50 Tm (AB'+(newlines?'\\012':'')+') Tj'+(newlines?' 1 0 0 1 20 25 Tm (AB) Tj':'')+' ET'+(tagged?' EMC':'');
 const stream=data=>'<< /Length '+Buffer.byteLength(data)+' >>\nstream\n'+data+'\nendstream';
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
 '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',stream(content),
 '<< /Type /Font /Subtype /Type3 /Name /FigmaGlyphs /FontBBox [0 0 0 0] /FontMatrix [1 0 0 1 0 0] /CharProcs << /A 6 0 R /B 7 0 R /LF 8 0 R >> /Encoding << /Type /Encoding /Differences [10 /LF 65 /A /B] >> /ToUnicode 9 0 R /FirstChar 10 /LastChar 66 /Widths ['+Array.from({length:57},(_,i)=>i>=55?'.6':'0').join(' ')+'] /Resources << >> >>',
 stream('.6 0 .05 0 .45 .7 d1'+(paintingFont?' .05 0 .4 .7 re f':'')),stream('.6 0 .05 0 .45 .7 d1'),stream('0 0 0 0 0 0 d1'),
 stream('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Semantic def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 3 beginbfchar <0A> <000A> <41> <0041> <42> <0042> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end')];
 let pdf='%PDF-1.7\n',offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});
 const start=Buffer.byteLength(pdf);pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
 pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';return Uint8Array.from(Buffer.from(pdf)).buffer;
}
