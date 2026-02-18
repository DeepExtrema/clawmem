declare module "kuzu" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class Database {
    constructor(dbPath: string, bufferPoolSize?: number);
  }
  export class Connection {
    constructor(db: Database);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query(cypher: string, params?: Record<string, unknown>): Promise<QueryResult>;
  }
  export class QueryResult {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAll(): Promise<Array<Record<string, unknown>>>;
    close(): void;
  }
}
