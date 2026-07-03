const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const sourceFiles = [
  'src/main/00-foundation.js',
  'src/main/10-modal-and-delegates.js',
  'src/main/20-tools/00-duplicate-check.js',
  'src/main/20-tools/10-emby-search-player.js',
  'src/main/20-tools/20-service-modals.js',
  'src/main/20-tools/30-wtl-search-results.js',
  'src/main/30-settings/00-state-lifecycle.js',
  'src/main/30-settings/10-tags-ratings.js',
  'src/main/30-settings/20-maintenance-render.js',
  'src/main/30-settings/30-maintenance-actions.js',
  'src/main/40-search.js',
  'src/main/50-movies/00-ratings-and-drag.js',
  'src/main/50-movies/10-edit-modal.js',
  'src/main/50-movies/20-results-table.js',
  'src/main/50-movies/30-pagination-formatting.js',
  'src/main/60-thumbnail/00-state-lifecycle.js',
  'src/main/60-thumbnail/10-init-source-controls.js',
  'src/main/60-thumbnail/20-emby-browser.js',
  'src/main/60-thumbnail/30-local-browser.js',
  'src/main/60-thumbnail/40-video-controls.js',
  'src/main/60-thumbnail/50-capture-batch.js',
  'src/main/60-thumbnail/60-capture-grid.js',
  'src/main/60-thumbnail/70-export-utils.js',
  'src/main/70-images/00-upload.js',
  'src/main/70-images/10-viewer-layout.js',
  'src/main/70-images/20-viewer-navigation.js'
];
const outputFile = 'static/main.js';

const chunks = sourceFiles.map((file) => (
  fs.readFileSync(path.join(projectRoot, file), 'utf8').replace(/(?:\r?\n)+$/, '')
));
const outputPath = path.join(projectRoot, outputFile);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${chunks.join('\n')}\n`);
console.log(`Built ${outputFile} from ${sourceFiles.length} source files`);
