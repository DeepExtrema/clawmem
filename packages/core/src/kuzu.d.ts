declare module "kuzu" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export class Database {
    constructor(dbPath: string, bufferPoolSize?: number);
  }
  export class PreparedStatement {
    isSuccess(): boolean;
    getErrorMessage(): string;
  }
  export class Connection {
    constructor(db: Database);
    query(cypher: string, progressCallback?: () => void): Promise<QueryResult>;
    prepare(cypher: string): Promise<PreparedStatement>;
    execute(ps: PreparedStatement, params?: Record<string, unknown>): Promise<QueryResult>;
  }
  export class QueryResult {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getAll(): Promise<Array<Record<string, unknown>>>;
    close(): void;
  }
}
