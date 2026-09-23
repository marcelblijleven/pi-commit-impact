#!/usr/bin/env node
import { tsImport } from "tsx/esm/api";

const { main } = await tsImport("./cli.ts", import.meta.url);
process.exitCode = await main();
