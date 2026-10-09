const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.join(__dirname, ".env") });

const User = require("./models/User");
const Conversation = require("./models/Conversation");
const Message = require("./models/Message");

const seedDatabase = async () => {
  try {
    console.log("Connecting to MongoDB:", process.env.MONGO_URI ? "URI found" : "No URI");
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected successfully.");

    // 1. Prepare users
    const defaultPassword = await bcrypt.hash("password123", 10);

    const usersData = [
      {
        name: "Khan shamshad",
        username: "shamshad",
        email: "shamshad@pulsechat.com",
        password: defaultPassword,
        status: "online",
      },
      {
        name: "Afreen Khan",
        username: "afreen",
        email: "afreen@pulsechat.com",
        password: defaultPassword,
        status: "online",
      },
      {
        name: "Priya Mali",
        username: "priyamali",
        email: "priya@pulsechat.com",
        password: defaultPassword,
        status: "offline",
      },
      {
        name: "Vaibhav Bhai Nexcore",
        username: "vaibhav",
        email: "vaibhav@pulsechat.com",
        password: defaultPassword,
        status: "online",
      },
      {
        name: "Muaz Theem",
        username: "muaztheem",
        email: "muaz@pulsechat.com",
        password: defaultPassword,
        status: "online",
      },
      {
        name: "HR Anjali",
        username: "anjali",
        email: "anjali@pulsechat.com",
        password: defaultPassword,
        status: "offline",
      },
      {
        name: "Shadab Nexa Core",
        username: "shadab",
        email: "shadab@pulsechat.com",
        password: defaultPassword,
        status: "online",
      },
      {
        name: "Hafiz Brother",
        username: "hafiz",
        email: "hafiz@pulsechat.com",
        password: defaultPassword,
        status: "offline",
      },
    ];

    const userMap = {};
    for (const u of usersData) {
      let existing = await User.findOne({ email: u.email });
      if (!existing) {
        existing = await User.findOne({ username: u.username });
      }
      if (!existing) {
        existing = await User.create(u);
        console.log(`Created user: ${u.name}`);
      } else {
        existing.name = u.name;
        existing.status = u.status;
        await existing.save();
        console.log(`Updated user: ${u.name}`);
      }
      userMap[u.username] = existing;
    }

    // Also update any existing user without name
    const shamshad = userMap["shamshad"];

    // 2. Clear old test conversations and messages for a clean WhatsApp matching layout
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    console.log("Cleared old conversations & messages");

    // 3. Create Conversations & Messages matching the WhatsApp screenshot
    const now = new Date();

    // A. "Khan shamshad (You)" - Self note/chat (Pinned, Yesterday, ✓✓ PRD)
    const convYou = await Conversation.create({
      type: "direct",
      name: "Khan shamshad (You)",
      members: [shamshad._id],
      createdBy: shamshad._id,
      updatedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), // Yesterday
    });
    const msgYou = await Message.create({
      conversation: convYou._id,
      sender: shamshad._id,
      content: "PRD",
      readBy: [shamshad._id],
      createdAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    });
    convYou.lastMessage = msgYou._id;
    await convYou.save();

    // B. "Khan family" - Group chat (Afreen: 📷 Photo, 9:58 am)
    const convFamily = await Conversation.create({
      type: "group",
      name: "Khan family",
      members: [shamshad._id, userMap["afreen"]._id],
      admins: [shamshad._id],
      createdBy: shamshad._id,
      updatedAt: new Date(now.getTime() - 15 * 60 * 1000),
    });
    const msgFamily = await Message.create({
      conversation: convFamily._id,
      sender: userMap["afreen"]._id,
      content: "📷 Photo",
      type: "text",
      createdAt: new Date(now.getTime() - 15 * 60 * 1000),
    });
    convFamily.lastMessage = msgFamily._id;
    await convFamily.save();

    // C. "Muslim Community" - Group chat (~FALAHCODE: We are seeking ..., 9:56 am)
    const convCommunity = await Conversation.create({
      type: "group",
      name: "Muslim Community",
      members: [shamshad._id, userMap["muaztheem"]._id, userMap["afreen"]._id],
      admins: [shamshad._id],
      createdBy: userMap["muaztheem"]._id,
      updatedAt: new Date(now.getTime() - 17 * 60 * 1000),
    });
    const msgCommunity = await Message.create({
      conversation: convCommunity._id,
      sender: userMap["muaztheem"]._id,
      content: "~FALAHCODE: We are seeking volunteers for the upcoming community charity drive",
      createdAt: new Date(now.getTime() - 17 * 60 * 1000),
    });
    convCommunity.lastMessage = msgCommunity._id;
    await convCommunity.save();

    // D. "Priya Mali" - Direct chat (✓ Day 440, 9:48 am)
    const convPriya = await Conversation.create({
      type: "direct",
      members: [shamshad._id, userMap["priyamali"]._id],
      createdBy: shamshad._id,
      updatedAt: new Date(now.getTime() - 25 * 60 * 1000),
    });
    const msgPriya = await Message.create({
      conversation: convPriya._id,
      sender: shamshad._id,
      content: "Day 440",
      deliveredTo: [userMap["priyamali"]._id],
      createdAt: new Date(now.getTime() - 25 * 60 * 1000),
    });
    convPriya.lastMessage = msgPriya._id;
    await convPriya.save();

    // E. "Nexcore Alliance Tech Team" - Group chat (Nexcore HR (Anjali) Ma'am: Dear Team..., 9:48 am)
    const convNexcore = await Conversation.create({
      type: "group",
      name: "Nexcore Alliance Tech Team",
      members: [shamshad._id, userMap["anjali"]._id, userMap["vaibhav"]._id],
      admins: [userMap["anjali"]._id],
      createdBy: userMap["anjali"]._id,
      updatedAt: new Date(now.getTime() - 25 * 60 * 1000),
    });
    const msgNexcore = await Message.create({
      conversation: convNexcore._id,
      sender: userMap["anjali"]._id,
      content: "Nexcore HR (Anjali) Ma'am: Dear Team, please submit your weekly sprint updates by 5 PM today.",
      createdAt: new Date(now.getTime() - 25 * 60 * 1000),
    });
    convNexcore.lastMessage = msgNexcore._id;
    await convNexcore.save();

    // F. "Vaibhav Bhai Nexcore" - Direct chat (Take a look at this 10000 mAh 22.5 W ..., 9:27 am)
    const convVaibhav = await Conversation.create({
      type: "direct",
      members: [shamshad._id, userMap["vaibhav"]._id],
      createdBy: userMap["vaibhav"]._id,
      updatedAt: new Date(now.getTime() - 45 * 60 * 1000),
    });
    const msgVaibhav = await Message.create({
      conversation: convVaibhav._id,
      sender: userMap["vaibhav"]._id,
      content: "Take a look at this 10000 mAh 22.5 W fast charger power bank deal on Amazon",
      createdAt: new Date(now.getTime() - 45 * 60 * 1000),
    });
    convVaibhav.lastMessage = msgVaibhav._id;
    await convVaibhav.save();

    // G. "Muaz Theem" - Direct chat (Reacted 👍 to: 'Passing marks try kr', 8:55 am)
    const convMuaz = await Conversation.create({
      type: "direct",
      members: [shamshad._id, userMap["muaztheem"]._id],
      createdBy: userMap["muaztheem"]._id,
      updatedAt: new Date(now.getTime() - 75 * 60 * 1000),
    });
    const msgMuaz = await Message.create({
      conversation: convMuaz._id,
      sender: userMap["muaztheem"]._id,
      content: "Passing marks try kr",
      reactions: [{ user: shamshad._id, emoji: "👍" }],
      createdAt: new Date(now.getTime() - 75 * 60 * 1000),
    });
    convMuaz.lastMessage = msgMuaz._id;
    await convMuaz.save();

    // H. "PRIME ⚡" - Group chat (Shadab Nexa Core: Morning Follow..., 8:52 am)
    const convPrime = await Conversation.create({
      type: "group",
      name: "PRIME ⚡",
      members: [shamshad._id, userMap["shadab"]._id],
      admins: [userMap["shadab"]._id],
      createdBy: userMap["shadab"]._id,
      updatedAt: new Date(now.getTime() - 80 * 60 * 1000),
    });
    const msgPrime = await Message.create({
      conversation: convPrime._id,
      sender: userMap["shadab"]._id,
      content: "Shadab Nexa Core: Morning Follow-up sync at 11 AM sharp",
      createdAt: new Date(now.getTime() - 80 * 60 * 1000),
    });
    convPrime.lastMessage = msgPrime._id;
    await convPrime.save();

    // I. "Hafizzi Brothers 💥" - Group chat (12:26 am)
    const convHafiz = await Conversation.create({
      type: "group",
      name: "Hafizzi Brothers 💥",
      members: [shamshad._id, userMap["hafiz"]._id],
      admins: [userMap["hafiz"]._id],
      createdBy: userMap["hafiz"]._id,
      updatedAt: new Date(now.getTime() - 9 * 60 * 60 * 1000),
    });
    const msgHafiz = await Message.create({
      conversation: convHafiz._id,
      sender: userMap["hafiz"]._id,
      content: "All orders confirmed and dispatched today",
      createdAt: new Date(now.getTime() - 9 * 60 * 60 * 1000),
    });
    convHafiz.lastMessage = msgHafiz._id;
    await convHafiz.save();

    console.log("🎉 Seed completed! 9 authentic conversations matching the screenshot created.");
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
};

seedDatabase();
