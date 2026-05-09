const fs = require('fs');
const graph = JSON.parse(fs.readFileSync('./graphify-out/graph.json', 'utf8'));

const chequeFiles = [
  'packages/api/helpers/chequeAmountWords.js',
  'packages/api/helpers/pdf/chequePdf.js',
  'packages/api/routes/chequeRoutes.js',
  'packages/web/src/pages/ChequePrintingPage.jsx',
];

const nodes = new Map(graph.nodes.map(n => [n.id, n]));

const connections = [];

graph.links.forEach(link => {
  const sourceNode = nodes.get(link.source);
  const targetNode = nodes.get(link.target);
  
  if (!sourceNode || !targetNode) return;
  
  const sourceIsCheque = chequeFiles.includes(sourceNode.source_file);
  const targetIsCheque = chequeFiles.includes(targetNode.source_file);
  
  if (sourceIsCheque || targetIsCheque) {
    // Only capture cross-file links to keep it simpler, or we can look at all.
    // Let's capture all where at least one is a cheque file, but format nicely.
    if (sourceNode.source_file !== targetNode.source_file) {
      connections.push({
        source: `${sourceNode.label} (${sourceNode.source_file})`,
        target: `${targetNode.label} (${targetNode.source_file})`,
        type: link.type || 'dependency'
      });
    }
  }
});

// Let's group connections by source file
const output = {};
connections.forEach(c => {
  if (!output[c.source]) output[c.source] = [];
  output[c.source].push(`${c.type} -> ${c.target}`);
});

console.log(JSON.stringify(output, null, 2));
