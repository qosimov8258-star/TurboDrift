import sharp from 'sharp';
const d='/private/tmp/claude-501/-Users-ismoil-Desktop-game/d6b86078-6f3f-4632-b4d0-25766dfeb358/scratchpad/';
const names=['bmw_m3','bmw_gtr','charger','ferrari','amg','supra_gt300','supra_mk4'];
const idx=process.argv[2]||'0';
const tiles=[];
for(let i=0;i<names.length;i++){tiles.push({input:await sharp(d+names[i]+'_'+idx+'.jpg').resize(450,300).toBuffer(),left:(i%3)*450,top:Math.floor(i/3)*300});}
await sharp({create:{width:1350,height:900,channels:3,background:'#222'}}).composite(tiles).jpeg({quality:80}).toFile(d+'sheet'+idx+'.jpg');
