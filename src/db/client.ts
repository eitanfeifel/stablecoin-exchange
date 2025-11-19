import { Pool } from "pg";
import { DB_CONFIG } from "./dbConfig";

export const pool = new Pool(DB_CONFIG);