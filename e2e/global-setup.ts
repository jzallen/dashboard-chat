import * as fs from "fs";
import * as path from "path";

const BACKEND_URL = "http://localhost:8000";
const FRONTEND_URL = "http://localhost:5173";
const WORKER_URL = "http://localhost:8787";
const AUTH_TOKEN = "dev-token-static";

const CSV_CONTENT = `ID,Name,Category,Amount,Quantity,In Stock
1,Widget A,Electronics,$29.99,150,true
2,Widget B,Electronics,$49.99,75,true
3,Gadget X,Accessories,$15.00,200,true
4,Gadget Y,Accessories,$8.50,300,false
5,Device Pro,Electronics,$299.99,12,true
6,Device Lite,Electronics,$199.99,45,false
7,Tool Alpha,Hardware,$125.00,30,true
8,Tool Beta,Hardware,$75.00,60,true
9,Part 101,Components,$3.25,500,false
10,Part 102,Components,$1.50,1000,false`;

async function healthCheck(url: string, label: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`${label} returned status ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `${label} health check failed at ${url}: ${err instanceof Error ? err.message : err}`
    );
  }
}

async function globalSetup() {
  // Health-check all services
  await Promise.all([
    healthCheck(`${BACKEND_URL}/health`, "Backend"),
    healthCheck(FRONTEND_URL, "Frontend"),
    healthCheck(`${WORKER_URL}/health`, "Worker"),
  ]);

  // Create test project
  const projectRes = await fetch(`${BACKEND_URL}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({ name: "E2E Test Project" }),
  });

  if (!projectRes.ok) {
    throw new Error(
      `Failed to create project: ${projectRes.status} ${await projectRes.text()}`
    );
  }

  const projectData = await projectRes.json();
  const projectId = projectData.data.id;

  // Upload CSV as dataset
  const blob = new Blob([CSV_CONTENT], { type: "text/csv" });
  const formData = new FormData();
  formData.append("file", blob, "products.csv");
  formData.append("project_id", projectId);

  const uploadRes = await fetch(`${BACKEND_URL}/api/uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
    body: formData,
  });

  if (!uploadRes.ok) {
    throw new Error(
      `Failed to upload CSV: ${uploadRes.status} ${await uploadRes.text()}`
    );
  }

  const uploadData = await uploadRes.json();
  const datasetId = uploadData.data.id;

  // Write seed data
  const seedPath = path.resolve(__dirname, ".seed-data.json");
  fs.writeFileSync(
    seedPath,
    JSON.stringify({ projectId, datasetId }, null, 2)
  );

  console.log(
    `Global setup complete: projectId=${projectId}, datasetId=${datasetId}`
  );
}

export default globalSetup;
