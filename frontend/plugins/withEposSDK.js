/**
 * Expo Config Plugin: withEposSDK
 *
 * Automatically integrates eposapi.jar (Databank EPOS SDK) into the Android
 * build during `expo prebuild` / EAS Build without needing to commit the
 * android/ directory.
 *
 * Prerequisites:
 *   1. JAR is at frontend/assets/jars/EposOpenAPIv26_release 2.jar  (already in place)
 *   2. Add "./plugins/withEposSDK" to the "plugins" array in app.json  (already done)
 *   3. Run `eas build --platform android`
 *
 * What this plugin does:
 *   - Copies eposapi.jar  →  android/app/libs/eposapi.jar
 *   - Copies EposModule.java + EposPackage.java into the correct package dir
 *   - Adds `implementation fileTree(dir:'libs')` to app/build.gradle
 *   - Registers EposPackage in MainApplication (Kotlin & Java)
 */

const {
  withDangerousMod,
  withAppBuildGradle,
  withMainApplication,
} = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

// ─── Step 1: Copy JAR + Java source files ─────────────────────────────────────

function withEposCopyFiles(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const projectRoot   = cfg.modRequest.projectRoot;          // .../frontend
      const platformRoot  = cfg.modRequest.platformProjectRoot;  // .../frontend/android

      const androidPkg    = cfg.android?.package ?? 'mn.uboil.pos';
      const pkgPath       = androidPkg.replace(/\./g, '/');

      // ── Copy JAR ────────────────────────────────────────────────────────────
      // JAR lives at frontend/assets/jars/EposOpenAPIv26_release 2.jar
      const jarSrc  = path.join(projectRoot, 'assets', 'jars', 'EposOpenAPIv26_release 2.jar');
      const libsDir = path.join(platformRoot, 'app', 'libs');

      if (!fs.existsSync(jarSrc)) {
        throw new Error(
          `[withEposSDK] eposapi.jar not found at ${jarSrc}\n` +
          `Expected: frontend/assets/jars/EposOpenAPIv26_release 2.jar`
        );
      }

      fs.mkdirSync(libsDir, { recursive: true });
      fs.copyFileSync(jarSrc, path.join(libsDir, 'eposapi.jar'));
      console.log('[withEposSDK] Copied EposOpenAPIv26_release 2.jar → android/app/libs/eposapi.jar');

      // ── Copy Java source files ───────────────────────────────────────────────
      const javaDir = path.join(
        platformRoot,
        'app', 'src', 'main', 'java',
        ...pkgPath.split('/'),
        'epos'
      );
      fs.mkdirSync(javaDir, { recursive: true });

      const moduleSrc = path.join(projectRoot, 'modules', 'epos', 'EposModule.java');
      const pkgSrc    = path.join(projectRoot, 'modules', 'epos', 'EposPackage.java');

      if (!fs.existsSync(moduleSrc) || !fs.existsSync(pkgSrc)) {
        throw new Error(
          `[withEposSDK] Java source files not found at frontend/modules/epos/\n` +
          `Expected: EposModule.java and EposPackage.java`
        );
      }

      // The Java files have the package hardcoded as mn.uboil.pos.epos.
      // If your package differs, do a find-and-replace here.
      let moduleContent = fs.readFileSync(moduleSrc, 'utf8');
      let pkgContent    = fs.readFileSync(pkgSrc,    'utf8');

      if (androidPkg !== 'mn.uboil.pos') {
        moduleContent = moduleContent.replace(/^package mn\.uboil\.pos\.epos;/m, `package ${androidPkg}.epos;`);
        pkgContent    = pkgContent   .replace(/^package mn\.uboil\.pos\.epos;/m, `package ${androidPkg}.epos;`);
      }

      fs.writeFileSync(path.join(javaDir, 'EposModule.java'),  moduleContent, 'utf8');
      fs.writeFileSync(path.join(javaDir, 'EposPackage.java'), pkgContent,    'utf8');
      console.log(`[withEposSDK] Copied Java sources → android/app/src/main/java/${pkgPath}/epos/`);

      return cfg;
    },
  ]);
}

// ─── Step 2: Add JAR to build.gradle ──────────────────────────────────────────

function withEposBuildGradle(config) {
  return withAppBuildGradle(config, (cfg) => {
    const src = cfg.modResults.contents;

    if (src.includes("fileTree(dir: 'libs'")) {
      return cfg; // already patched
    }

    // Insert after the opening `dependencies {` line
    cfg.modResults.contents = src.replace(
      /^(dependencies\s*\{)/m,
      `$1\n    implementation fileTree(dir: 'libs', include: ['*.jar'])`
    );

    console.log('[withEposSDK] Added fileTree libs dependency to app/build.gradle');
    return cfg;
  });
}

// ─── Step 3: Register EposPackage in MainApplication ──────────────────────────

function withEposMainApplication(config) {
  return withMainApplication(config, (cfg) => {
    const src      = cfg.modResults.contents;
    const isKotlin = cfg.modResults.language === 'kt';

    if (src.includes('EposPackage')) {
      return cfg; // already registered
    }

    const androidPkg = cfg.android?.package ?? 'mn.uboil.pos';
    const importLine = isKotlin
      ? `import ${androidPkg}.epos.EposPackage`
      : `import ${androidPkg}.epos.EposPackage;`;

    // ── Add import after the last import statement ────────────────────────────
    let patched = src;
    const importMatches = [...src.matchAll(/^import .+$/gm)];
    if (importMatches.length > 0) {
      const last = importMatches[importMatches.length - 1];
      const insertAt = last.index + last[0].length;
      patched = patched.slice(0, insertAt) + '\n' + importLine + patched.slice(insertAt);
    }

    // ── Register package in getPackages() ────────────────────────────────────
    if (isKotlin) {
      // Kotlin new-arch template:
      //   PackageList(this).packages.apply {
      //     // add(MyReactNativePackage())
      //   }
      patched = patched.replace(
        /PackageList\(this\)\.packages\.apply\s*\{/,
        `PackageList(this).packages.apply {\n              add(EposPackage())`
      );
    } else {
      // Java template:
      //   return packages;
      patched = patched.replace(
        /return packages;/,
        `packages.add(new EposPackage());\n        return packages;`
      );
    }

    cfg.modResults.contents = patched;
    console.log('[withEposSDK] Registered EposPackage in MainApplication');
    return cfg;
  });
}

// ─── Compose all steps ────────────────────────────────────────────────────────

module.exports = function withEposSDK(config) {
  config = withEposCopyFiles(config);
  config = withEposBuildGradle(config);
  config = withEposMainApplication(config);
  return config;
};
