const { createBaselineConfig } = require('./lighthouse.config.cjs');

module.exports = createBaselineConfig(process.env.LIGHTHOUSE_PROFILE ?? 'desktop');
