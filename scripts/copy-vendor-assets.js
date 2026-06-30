const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const assets = [
  {
    from: path.join(projectRoot, 'node_modules', 'bulma', 'css', 'bulma.min.css'),
    to: path.join(projectRoot, 'static', 'vendor', 'bulma.min.css')
  }
];

for (const asset of assets) {
  fs.mkdirSync(path.dirname(asset.to), { recursive: true });
  fs.copyFileSync(asset.from, asset.to);
}
