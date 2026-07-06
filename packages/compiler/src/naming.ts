export function pascal(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export function camel(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

/** io.appcraft.glucolog -> io/appcraft/glucolog */
export function packagePath(pkg: string): string {
  return pkg.replace(/\./g, "/");
}

/** logReading -> LogReadingScreen */
export function screenName(flowName: string): string {
  return `${pascal(flowName)}Screen`;
}

/** GlucoLog -> "GlucoLog", strips characters not allowed in Gradle/XML names. */
export function safeName(appName: string): string {
  return appName.replace(/[^A-Za-z0-9]/g, "");
}

/** GlucoseReading -> glucose_reading */
export function snake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
