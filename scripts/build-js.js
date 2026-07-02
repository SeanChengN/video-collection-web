const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceFiles = [
  'src/main/00-foundation.js',
  'src/main/10-modal-and-delegates.js',
  'src/main/20-tools-and-services.js',
  'src/main/30-settings-maintenance.js',
  'src/main/40-search.js',
  'src/main/50-edit-results.js',
  'src/main/60-thumbnail/00-state-lifecycle.js',
  'src/main/60-thumbnail/10-init-source-controls.js',
  'src/main/60-thumbnail/20-emby-browser.js',
  'src/main/60-thumbnail/30-local-browser.js',
  'src/main/60-thumbnail/40-video-controls.js',
  'src/main/60-thumbnail/50-capture-batch.js',
  'src/main/60-thumbnail/60-capture-grid.js',
  'src/main/60-thumbnail/70-export-utils.js',
  'src/main/70-image-upload-viewer.js'
];
const outputFile = 'static/main.js';

const chunks = sourceFiles.map((file) => fs.readFileSync(path.join(projectRoot, file)));
const outputPath = path.join(projectRoot, outputFile);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.concat(chunks));
console.log(`Built ${outputFile} from ${sourceFiles.length} source files`);
