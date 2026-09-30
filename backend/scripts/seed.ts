import { prisma } from "../src/infrastructure/database/prisma.js";

async function main() {
  const user = await prisma.user.upsert({
    where: {
      googleId: "dev-google-id",
    },
    update: {},
    create: {
      googleId: "dev-google-id",
      email: "dev@reachbox.local",
      name: "Development User",
    },
  });

  const workspace = await prisma.workspace.upsert({
    where: {
      id: "11111111-1111-4111-8111-111111111111",
    },
    update: {},
    create: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Development Workspace",
    },
  });

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id,
      },
    },
    update: {
      role: "OWNER",
    },
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER",
    },
  });

  const sender = await prisma.senderAccount.upsert({
    where: {
      workspaceId_email: {
        workspaceId: workspace.id,
        email: "sender@reachbox.local",
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      email: "sender@reachbox.local",
      displayName: "ReachBox Development Sender",
      smtpHost: "smtp.ethereal.email",
      smtpPort: 587,
      smtpUser: "development-user",
      smtpPassword: "development-password",
      status: "ACTIVE",
    },
  });

  console.log("Development seed created.");
  console.log({
    userId: user.id,
    workspaceId: workspace.id,
    senderId: sender.id,
  });
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
