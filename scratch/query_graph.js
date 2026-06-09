const fs = require('fs');
const graph = JSON.parse(fs.readFileSync('./graphify-out/graph.json', 'utf8'));

const query = process.argv[2] || 'cycle';
console.log(`Querying graph for: "${query}"`);

// Find all nodes that contain the query string in their ID, label, or file path.
const matchingNodes = graph.nodes.filter(node => {
  const file = node.source_file || '';
  const id = node.id || '';
  const label = node.label || '';
  return file.toLowerCase().includes(query.toLowerCase()) || 
         id.toLowerCase().includes(query.toLowerCase()) || 
         label.toLowerCase().includes(query.toLowerCase());
});

console.log(`Found ${matchingNodes.length} matching nodes:`);
matchingNodes.forEach(node => {
  console.log(`- ${node.label} [${node.type}] in ${node.source_file}`);
});

// Let's also look at connections between matching nodes and other nodes
const connections = [];
const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

graph.links.forEach(link => {
  const sourceNode = nodeMap.get(link.source);
  const targetNode = nodeMap.get(link.target);
  if (!sourceNode || !targetNode) return;
  
  const sourceMatches = matchingNodes.some(n => n.id === sourceNode.id);
  const targetMatches = matchingNodes.some(n => n.id === targetNode.id);
  
  if (sourceMatches || targetMatches) {
    connections.push({
      source: `${sourceNode.label} (${sourceNode.source_file})`,
      target: `${targetNode.label} (${targetNode.source_file})`,
      type: link.type || 'dependency'
    });
  }
});

console.log(`\nFound ${connections.length} connections:`);
const uniqueConnections = Array.from(new Set(connections.map(c => JSON.stringify(c)))).map(s => JSON.parse(s));
uniqueConnections.slice(0, 30).forEach(c => {
  console.log(`  ${c.source} --[${c.type}]--> ${c.target}`);
});
