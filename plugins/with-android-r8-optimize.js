const { withAppBuildGradle } = require('expo/config-plugins');

const DEFAULT_RULES = 'getDefaultProguardFile("proguard-android.txt")';
const OPTIMIZE_RULES = 'getDefaultProguardFile("proguard-android-optimize.txt")';

/**
 * Las reglas por defecto de Android traen `-dontoptimize`: R8 ofusca y achica, pero no
 * optimiza el DEX. Las de `-optimize` dejan que R8 también optimice el código en release.
 * Solo tiene efecto con `android.enableMinifyInReleaseBuilds` (expo-build-properties).
 */
module.exports = function withAndroidR8Optimize(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('with-android-r8-optimize: se esperaba android/app/build.gradle en Groovy.');
    }
    if (mod.modResults.contents.includes(DEFAULT_RULES)) {
      mod.modResults.contents = mod.modResults.contents.replace(DEFAULT_RULES, OPTIMIZE_RULES);
    } else if (!mod.modResults.contents.includes(OPTIMIZE_RULES)) {
      throw new Error('with-android-r8-optimize: no se encontró getDefaultProguardFile en build.gradle.');
    }
    return mod;
  });
};
