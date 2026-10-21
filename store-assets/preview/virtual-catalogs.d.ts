declare module "virtual:ai-limits-preview-catalogs" {
  const catalogs: Record<"en" | "zh_CN", Record<string, { message: string }>>;
  export default catalogs;
}
