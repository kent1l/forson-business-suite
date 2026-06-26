const { withDangerousMod, withGradleProperties } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Fix 1: Pin Gradle wrapper to 9.3.1-all (matches EAS cloud builder)
const withGradle931 = (config) =>
  withDangerousMod(config, [
    'android',
    (config) => {
      const wrapperPath = path.join(
        config.modRequest.platformProjectRoot,
        'gradle/wrapper/gradle-wrapper.properties'
      );
      if (fs.existsSync(wrapperPath)) {
        let content = fs.readFileSync(wrapperPath, 'utf-8');
        content = content.replace(
          /distributionUrl=.*gradle-.*-(bin|all)\.zip/,
          'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.3.1-all.zip'
        );
        fs.writeFileSync(wrapperPath, content);
      }
      return config;
    },
  ]);

// Fix 2: Set Gradle memory, parallelism, and build properties
const GRADLE_PROPS = [
  { key: 'org.gradle.jvmargs',       value: '-Xmx6g -XX:MaxMetaspaceSize=512m' },
  { key: 'org.gradle.workers.max',   value: '4' },
  { key: 'org.gradle.parallel',      value: 'true' },
  { key: 'android.enableJetifier',   value: 'false' },
];

const withGradleMemory = (config) =>
  withGradleProperties(config, (config) => {
    for (const { key, value } of GRADLE_PROPS) {
      const existing = config.modResults.find(
        (item) => item.type === 'property' && item.key === key
      );
      if (existing) {
        existing.value = value;
      } else {
        config.modResults.push({ type: 'property', key, value });
      }
    }
    return config;
  });

module.exports = (config) => withGradleMemory(withGradle931(config));
