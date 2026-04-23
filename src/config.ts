export async function manageConfig(
  action: string,
  key?: string,
  value?: string,
): Promise<void> {
  console.log(`Config ${action} ${key ?? ""} ${value ?? ""}`);
}
