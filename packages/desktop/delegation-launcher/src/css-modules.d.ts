/** Build-time names for package-owned CSS Modules. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
