// Keep the application's synchronous SQL contract on Cloudflare's durable SQLite.
export function database(storage){
  return {
    exec:sql=>storage.sql.exec(sql),
    prepare:sql=>({
      get:(...values)=>storage.sql.exec(sql,...values).toArray()[0],
      all:(...values)=>storage.sql.exec(sql,...values).toArray(),
      run:(...values)=>{const cursor=storage.sql.exec(sql,...values);return {changes:cursor.rowsWritten};}
    }),
    transactionSync:callback=>storage.transactionSync(callback),
    close(){}
  };
}
