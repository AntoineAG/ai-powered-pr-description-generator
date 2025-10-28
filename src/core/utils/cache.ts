export class ModelCache<T> {
  private readonly map = new Map<string, T>();
  constructor(private readonly builder: (name: string) => T) {}
  getOrBuild(name: string): T {
    const existing = this.map.get(name);
    if (existing) return existing;
    const built = this.builder(name);
    this.map.set(name, built);
    return built;
  }
}

