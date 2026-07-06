import type { AppModel } from "@appcraft-io/core";
import { packagePath, safeName } from "./naming.js";

/**
 * Material 3 theme from the model's seed color. On API 31+ dynamic color wins;
 * below that we derive a static scheme from the seed with deterministic mixes
 * (an approximation of the tonal palette — good defaults, not a design tool).
 */

function hexToRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/** mix(a, b, t) = a*(1-t) + b*t */
export function mix(a: string, b: string, t: number): string {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  return rgbToHex([
    ra[0] * (1 - t) + rb[0] * t,
    ra[1] * (1 - t) + rb[1] * t,
    ra[2] * (1 - t) + rb[2] * t,
  ]);
}

const WHITE = "#FFFFFF";
const BLACK = "#000000";

function kotlinColor(hex: string): string {
  return `Color(0xFF${hex.slice(1)})`;
}

export function emitTheme(model: AppModel, files: Map<string, string>): void {
  const pkg = model.app.package;
  const base = `app/src/main/java/${packagePath(pkg)}`;
  const app = safeName(model.app.name);
  const seed = model.theme?.seedColor ?? "#3F51B5";
  const darkMode = model.theme?.darkMode ?? "system";

  const light = {
    primary: seed,
    onPrimary: WHITE,
    primaryContainer: mix(seed, WHITE, 0.85),
    onPrimaryContainer: mix(seed, BLACK, 0.55),
    secondary: mix(seed, "#5F6368", 0.45),
    onSecondary: WHITE,
    secondaryContainer: mix(seed, WHITE, 0.9),
    onSecondaryContainer: mix(seed, BLACK, 0.6),
    background: mix(seed, WHITE, 0.97),
    onBackground: "#1B1B1F",
    surface: mix(seed, WHITE, 0.97),
    onSurface: "#1B1B1F",
    surfaceVariant: mix(seed, WHITE, 0.88),
    onSurfaceVariant: mix(seed, BLACK, 0.65),
    outline: mix(seed, "#79747E", 0.6),
    outlineVariant: mix(seed, WHITE, 0.75),
  };
  const dark = {
    primary: mix(seed, WHITE, 0.4),
    onPrimary: mix(seed, BLACK, 0.65),
    primaryContainer: mix(seed, BLACK, 0.45),
    onPrimaryContainer: mix(seed, WHITE, 0.85),
    secondary: mix(seed, "#C4C7C5", 0.5),
    onSecondary: mix(seed, BLACK, 0.7),
    secondaryContainer: mix(seed, BLACK, 0.55),
    onSecondaryContainer: mix(seed, WHITE, 0.8),
    background: "#141218",
    onBackground: "#E6E0E9",
    surface: "#141218",
    onSurface: "#E6E0E9",
    surfaceVariant: mix(seed, BLACK, 0.6),
    onSurfaceVariant: mix(seed, WHITE, 0.7),
    outline: mix(seed, "#938F99", 0.6),
    outlineVariant: mix(seed, BLACK, 0.5),
  };

  const scheme = (name: string, c: typeof light) => `val ${name} = ${
    name === "LightColors" ? "lightColorScheme" : "darkColorScheme"
  }(
    primary = ${kotlinColor(c.primary)},
    onPrimary = ${kotlinColor(c.onPrimary)},
    primaryContainer = ${kotlinColor(c.primaryContainer)},
    onPrimaryContainer = ${kotlinColor(c.onPrimaryContainer)},
    secondary = ${kotlinColor(c.secondary)},
    onSecondary = ${kotlinColor(c.onSecondary)},
    secondaryContainer = ${kotlinColor(c.secondaryContainer)},
    onSecondaryContainer = ${kotlinColor(c.onSecondaryContainer)},
    background = ${kotlinColor(c.background)},
    onBackground = ${kotlinColor(c.onBackground)},
    surface = ${kotlinColor(c.surface)},
    onSurface = ${kotlinColor(c.onSurface)},
    surfaceVariant = ${kotlinColor(c.surfaceVariant)},
    onSurfaceVariant = ${kotlinColor(c.onSurfaceVariant)},
    outline = ${kotlinColor(c.outline)},
    outlineVariant = ${kotlinColor(c.outlineVariant)},
)`;

  files.set(
    `${base}/ui/theme/Color.kt`,
    `package ${pkg}.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

// Derived deterministically from theme.seedColor ${seed}.
${scheme("LightColors", light)}

${scheme("DarkColors", dark)}
`,
  );

  const darkExpr =
    darkMode === "always" ? "true" : darkMode === "never" ? "false" : "isSystemInDarkTheme()";

  files.set(
    `${base}/ui/theme/Theme.kt`,
    `package ${pkg}.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

@Composable
fun ${app}Theme(
    darkTheme: Boolean = ${darkExpr},
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colorScheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        darkTheme -> DarkColors
        else -> LightColors
    }
    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        content = content,
    )
}
`,
  );

  files.set(
    `${base}/ui/theme/Type.kt`,
    `package ${pkg}.ui.theme

import androidx.compose.material3.Typography

val AppTypography = Typography()
`,
  );
}
