import "dotenv/config";
import { app } from "./app";

const port = process.env.PORT ? Number(process.env.PORT) : 4000;

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`AB Address Service listening on http://localhost:${port}`);
});
