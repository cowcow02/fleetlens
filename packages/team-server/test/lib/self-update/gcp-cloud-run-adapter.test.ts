import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetService = vi.fn();
const mockUpdateService = vi.fn();

vi.mock("@google-cloud/run", () => ({
  v2: {
    ServicesClient: vi.fn().mockImplementation(() => ({
      getService: mockGetService,
      updateService: mockUpdateService,
    })),
  },
}));

import { GcpCloudRunAdapter } from "../../../src/lib/self-update/gcp-cloud-run.js";

beforeEach(() => {
  process.env.K_SERVICE = "fleetlens-team-server";
  process.env.K_CONFIGURATION = "fleetlens-team-server";
  process.env.GCP_PROJECT_ID = "orbit";
  // Cloud Run injects these at runtime; the installer in Chunk 7 sets GCP_PROJECT_ID + region.
  process.env.GCP_REGION = "asia-southeast1";
  mockGetService.mockReset();
  mockUpdateService.mockReset();
});

describe("GcpCloudRunAdapter", () => {
  it("getCurrentImage returns the current image + tag", async () => {
    mockGetService.mockResolvedValue([
      { template: { containers: [{ image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2" }] } },
    ]);
    const adapter = new GcpCloudRunAdapter();
    const result = await adapter.getCurrentImage();
    expect(result).toEqual({ image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2", tag: "0.4.2" });
  });

  it("redeploy derives the image repo from the current image (Artifact Registry case)", async () => {
    // Mirrors the real orbit GCP deployment: image lives in Artifact Registry.
    mockGetService.mockResolvedValue([
      {
        name: "projects/orbit/locations/asia-southeast1/services/fleetlens-team-server",
        template: {
          containers: [{ image: "asia-southeast1-docker.pkg.dev/orbit/fleetlens/team-server:0.5.0" }],
        },
        serviceAccount: "1234-compute@developer.gserviceaccount.com",
      },
    ]);
    mockUpdateService.mockResolvedValue([
      { metadata: { revision: "fleetlens-team-server-00008-xyz" } },
    ]);

    const adapter = new GcpCloudRunAdapter();
    const result = await adapter.redeploy("0.5.1");

    expect(mockUpdateService).toHaveBeenCalledTimes(1);
    const [arg] = mockUpdateService.mock.calls[0];
    // Target image uses the SAME repo as the current image, just with the new tag.
    expect(arg.service.template.containers[0].image).toBe(
      "asia-southeast1-docker.pkg.dev/orbit/fleetlens/team-server:0.5.1",
    );
    expect(arg.service.serviceAccount).toBe("1234-compute@developer.gserviceaccount.com");
    expect(result.revisionId).toBe("fleetlens-team-server-00008-xyz");
  });

  it("redeploy also works when the current image uses GHCR (no Artifact Registry)", async () => {
    mockGetService.mockResolvedValue([
      {
        name: "projects/example/locations/us-central1/services/ts",
        template: { containers: [{ image: "ghcr.io/cowcow02/fleetlens-team-server:0.5.0" }] },
      },
    ]);
    mockUpdateService.mockResolvedValue([{ metadata: { revision: "ts-00002" } }]);
    const adapter = new GcpCloudRunAdapter();
    await adapter.redeploy("0.5.1");
    const [arg] = mockUpdateService.mock.calls[0];
    expect(arg.service.template.containers[0].image).toBe(
      "ghcr.io/cowcow02/fleetlens-team-server:0.5.1",
    );
  });

  it("throws at call time if required env vars are missing (constructor does not check)", async () => {
    delete process.env.GCP_PROJECT_ID;
    // Constructor must not throw even with env missing.
    const adapter = new GcpCloudRunAdapter();
    await expect(adapter.getCurrentImage()).rejects.toThrow(/GCP_PROJECT_ID/);

    process.env.GCP_PROJECT_ID = "orbit";
    delete process.env.GCP_REGION;
    await expect(adapter.redeploy("0.5.0")).rejects.toThrow(/GCP_REGION/);

    process.env.GCP_REGION = "asia-southeast1";
    delete process.env.K_SERVICE;
    await expect(adapter.getCurrentImage()).rejects.toThrow(/K_SERVICE/);
  });
});
