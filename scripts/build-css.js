const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceFiles = [
  'src/styles/00-mobile-base.css',
  'src/styles/10-services-tools.css',
  'src/styles/20-thumbnail.css',
  'src/styles/30-controls-ratings.css',
  'src/styles/40-images-rating-cells.css',
  'src/styles/50-modals-results.css',
  'src/styles/60-settings.css',
  'src/styles/70-search-effects-alerts.css'
];
const outputFile = 'static/non-critical.css';

const chunks = sourceFiles.map((file) => fs.readFileSync(path.join(projectRoot, file)));
const outputPath = path.join(projectRoot, outputFile);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.concat(chunks));
console.log(`Built ${outputFile} from ${sourceFiles.length} source files`);
