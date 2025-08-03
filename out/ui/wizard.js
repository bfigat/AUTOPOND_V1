"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWizard = runWizard;
exports.promptContinueOrConfig = promptContinueOrConfig;
exports.waitForAnyKey = waitForAnyKey;
const tslib_1 = require("tslib");
const inquirer_1 = tslib_1.__importDefault(require("inquirer"));
const chalk_1 = tslib_1.__importDefault(require("chalk"));
const child_process_1 = require("child_process");
const path_1 = tslib_1.__importDefault(require("path"));
const print_1 = require("../ui/print");
const swapping_1 = require("../swapping");
const launch_1 = require("../launch");
const metrics_1 = require("../metrics/metrics");
const borderboxstyles_1 = require("./styles/borderboxstyles");
const metrics_2 = require("../metrics/metrics");
const helpers_1 = require("../utils/helpers");
const runswap_1 = require("./modes/runswap");
const runmining_1 = require("./modes/runmining");
const runsettings_1 = require("./modes/runsettings");
const phantom_1 = require("../phantom");
const printtable_1 = require("./tables/printtable");
// ----------------------------------------------------------------------
// runWizard: the main wizard loop
// ----------------------------------------------------------------------
async function runWizard(fullConfig) {
    const { app, mining } = fullConfig;
    let swap = fullConfig.swap;
    // Outer loop: after a complete run, re‑prompt for mode selection.
    while (true) {
        await (0, helpers_1.d)(300);
        if (process.stdin.isPaused())
            process.stdin.resume();
        // --- Mode Selection ---
        let mode = "Ze Bot Stays On";
        let rounds = 0;
        const answer = await inquirer_1.default.prompt([
            {
                type: "list",
                name: "mode",
                message: chalk_1.default.bold.green("🔥 Choose a mode: "),
                choices: [
                    "⛏️  Mine",
                    "🤝  Swap",
                    "⛏️🤝  Mine and Swap",
                    "💻  Ze Bot Stays On",
                    "🔍  Magma Engine Viewer",
                    "📊  View Pond Statistics",
                    "Exit",
                ],
            },
        ]);
        const modeRaw = answer.mode;
        if (modeRaw === "Exit") {
            console.log(chalk_1.default.bold("Exiting..."));
            process.exit(0);
        }
        if (modeRaw.includes("View Pond Statistics")) {
            await (0, metrics_2.viewPondStatistics)();
            continue;
        }
        if (modeRaw.includes("Mine and Swap"))
            mode = "Mine and Swap";
        else if (modeRaw.includes("Mine") && !modeRaw.includes("Swap"))
            mode = "Mine";
        else if (modeRaw.includes("Swap") && !modeRaw.includes("Mine"))
            mode = "Swap";
        else if (modeRaw.includes("Magma Engine Viewer"))
            mode = "Magma Engine Viewer";
        else
            mode = "Ze Bot Stays On";
        if (mode !== "Ze Bot Stays On" && mode !== "Magma Engine Viewer") {
            const roundsAnswer = await inquirer_1.default.prompt([
                {
                    type: "number",
                    name: "rounds",
                    message: chalk_1.default.bold.green(mode === "Mine"
                        ? "⛏️  How many mining rounds do you want to run?"
                        : mode === "Swap"
                            ? "🤝  How many swap cycles do you want to run?"
                            : "⛏️🤝  How many mine and swap rounds do you want to run?"),
                    default: 1,
                    validate: (value) => value > 0 || "Please enter a number greater than 0",
                },
            ]);
            rounds = Number(roundsAnswer.rounds);
        }
        // --- Special Branch: Magma Engine Viewer ---
        if (mode === "Magma Engine Viewer") {
            const viewerProcess = (0, child_process_1.fork)(path_1.default.join(__dirname, "./modes/runmagmaviewer.js"), { stdio: "inherit" });
            await new Promise((resolve) => {
                viewerProcess.on("exit", resolve);
            });
            (0, print_1.printMessageLinesBorderBox)(["🔍 Viewer Closed"], borderboxstyles_1.magmaStyle);
            continue; // Restart outer loop.
        }
        // --- Wallet Prompt & Browser Setup ---
        let browser;
        let opPage;
        try {
            if (app.wizardMode) {
                const walletPrompt = await inquirer_1.default.prompt([
                    {
                        type: "confirm",
                        name: "walletReady",
                        message: (() => {
                            (0, print_1.printMessageLinesBorderBox)([
                                "WARNING: USE A BURNER WALLET!",
                                "PRIVATE KEYS ARE AT YOUR OWN RISK!",
                                "For safety guidelines, visit:",
                                (0, print_1.buildOsc8Hyperlink)("https://help.phantom.com/hc/en-us/articles/8071074929043-How-to-Initially-Setup-Your-Phantom-Wallet", "Phantom-The Basics"),
                            ], borderboxstyles_1.warningStyle);
                            (0, print_1.printMessageLinesBorderBox)(["👻 Confirm that you are ready to load Phantom?"], borderboxstyles_1.phantomStyle);
                            return "";
                        })(),
                        default: true,
                    },
                ]);
                if (!walletPrompt.walletReady) {
                    (0, print_1.printMessageLinesBorderBox)(["Wallet connection cancelled. Returning to mode selection..."], borderboxstyles_1.phantomStyle);
                    continue;
                }
                // Prompt for account import method.
                const methodChoice = await (0, phantom_1.promptAccountImportMethod)();
                app.manualaccountcreation = methodChoice === "manual";
                // Launch the browser, passing the methodChoice.
                const { browser: launchedBrowser } = await (0, launch_1.launchBrowser)(app, methodChoice);
                browser = launchedBrowser;
                const pages = await browser.pages();
                // Filter out extension pages, handling any pages that might throw an error.
                const nonExtensionPages = pages.filter((page) => {
                    try {
                        return !page.url().startsWith("chrome-extension://");
                    }
                    catch (err) {
                        return false;
                    }
                });
                if (nonExtensionPages.length === 0) {
                    throw new Error("No operational page found after browser launch.");
                }
                opPage = nonExtensionPages[0];
                (0, print_1.printMessageLinesBorderBox)(["🌐 Navigating to Pond0x..."], borderboxstyles_1.phantomStyle);
                await opPage.goto("https://pond0x.com", {
                    waitUntil: "load",
                    timeout: 60000,
                });
                await (0, swapping_1.connectwallet)(opPage, browser);
            }
            else {
                (0, print_1.printMessageLinesBorderBox)(["Default mode: automatically loading Phantom..."], borderboxstyles_1.phantomStyle);
                // Default mode: pass a default methodChoice (Miner 1).
                const defaultMethod = { env: "MINER1_PK", label: "Miner 1" };
                const { browser: launchedBrowser } = await (0, launch_1.launchBrowser)(app, defaultMethod);
                browser = launchedBrowser;
                const pages = await browser.pages();
                const nonExtensionPages = pages.filter((page) => {
                    try {
                        return !page.url().startsWith("chrome-extension://");
                    }
                    catch (err) {
                        return false;
                    }
                });
                if (nonExtensionPages.length === 0) {
                    throw new Error("No operational page found after browser launch.");
                }
                opPage = nonExtensionPages[0];
                await opPage.goto("https://pond0x.com", {
                    waitUntil: "load",
                    timeout: 60000,
                });
                await (0, swapping_1.connectwallet)(opPage, browser);
            }
        }
        catch (err) {
            console.error(chalk_1.default.red("Error during browser launch or wallet connection:"), err);
            if (browser)
                await browser.close();
            continue;
        }
        // --- Determine Effective Mode & Rounds ---
        let effectiveMode;
        let effectiveRounds;
        if (app.wizardMode) {
            effectiveMode =
                mode === "Ze Bot Stays On" ? app.defaultMode : mode;
            effectiveRounds = rounds;
        }
        else {
            effectiveMode = app.defaultMode;
            effectiveRounds = app.defaultCycleCount || 0;
        }
        const executionSummary = {
            Mode: effectiveMode,
            "Total Cycles": effectiveRounds > 0 ? effectiveRounds : "Infinite",
            activeMiningRetryDelayMs: mining.activeMiningRetryDelayMs,
            miningLoopFailRetryDelayMs: mining.miningLoopFailRetryDelayMs,
            miningSuccessDelayMs: mining.miningSuccessDelayMs,
        };
        if (effectiveMode === "Mine" || effectiveMode === "Mine and Swap") {
            (0, printtable_1.printTable)("⛏️  Mining config", mining);
        }
        // --- NEW: Trading Pair Selection for Swap ---
        if (effectiveMode === "Swap" || effectiveMode === "Mine and Swap") {
            if (swap.pairs && Array.isArray(swap.pairs)) {
                // If more than one pair is defined, prompt the user to choose one.
                if (swap.pairs.length > 1) {
                    const pairChoices = swap.pairs.map((pair, index) => {
                        return { name: `${pair.tokenA} / ${pair.tokenB}`, value: index };
                    });
                    const { selectedPairIndex } = await inquirer_1.default.prompt([
                        {
                            type: "list",
                            name: "selectedPairIndex",
                            message: chalk_1.default.bold.green("🤝  Choose a trading pair for swap:"),
                            choices: pairChoices,
                        },
                    ]);
                    const selectedPair = swap.pairs[selectedPairIndex];
                    // Merge the selected pair details into the overall swap config.
                    swap = Object.assign(Object.assign({}, swap), selectedPair);
                }
                else if (swap.pairs.length === 1) {
                    // Only one pair is available, so use it directly.
                    swap = Object.assign(Object.assign({}, swap), swap.pairs[0]);
                }
                else {
                    console.warn("No trading pairs defined in swap config. Using default swap settings.");
                }
            }
            (0, printtable_1.printTable)("🤝  Swap config", swap);
        }
        // --- Cycle Execution ---
        try {
            if (effectiveRounds > 0) {
                for (let i = 0; i < effectiveRounds; i++) {
                    (0, print_1.printMessageLinesBorderBox)([
                        `🚀 --- Autopond cycle ${i + 1} of ${effectiveRounds} (${effectiveMode}) ---`,
                    ], borderboxstyles_1.generalStyle);
                    if (effectiveMode === "Mine") {
                        (0, print_1.printMessageLinesBorderBox)(["Mining Process:"], borderboxstyles_1.miningStyle);
                        await (0, runmining_1.runMining)(opPage, browser, mining);
                    }
                    else if (effectiveMode === "Swap") {
                        (0, print_1.printMessageLinesBorderBox)(["Swap Process:"], borderboxstyles_1.swappingStyle);
                        const swapMetrics = await (0, runswap_1.runSwap)(opPage, browser, swap);
                        (0, metrics_1.accumulateSwapMetrics)(swapMetrics);
                    }
                    else if (effectiveMode === "Mine and Swap") {
                        (0, print_1.printMessageLinesBorderBox)(["Mining Process:"], borderboxstyles_1.miningStyle);
                        await (0, runmining_1.runMining)(opPage, browser, mining);
                        (0, print_1.printMessageLinesBorderBox)(["Swap Process:"], borderboxstyles_1.swappingStyle);
                        const swapMetrics = await (0, runswap_1.runSwap)(opPage, browser, swap);
                        (0, metrics_1.accumulateSwapMetrics)(swapMetrics);
                    }
                    (0, print_1.printMessageLinesBorderBox)([`✅ Cycle ${i + 1} complete`], borderboxstyles_1.generalStyle);
                }
            }
            else {
                let cycleCount = 0;
                while (true) {
                    cycleCount++;
                    (0, print_1.printMessageLinesBorderBox)([`🚀 --- Starting cycle ${cycleCount} ---`], borderboxstyles_1.generalStyle);
                    if (effectiveMode === "Mine") {
                        (0, print_1.printMessageLinesBorderBox)(["Mining Process:"], borderboxstyles_1.miningStyle);
                        await (0, runmining_1.runMining)(opPage, browser, mining);
                    }
                    else if (effectiveMode === "Swap") {
                        (0, print_1.printMessageLinesBorderBox)(["Swap Process:"], borderboxstyles_1.swappingStyle);
                        const swapMetrics = await (0, runswap_1.runSwap)(opPage, browser, swap);
                        (0, metrics_1.accumulateSwapMetrics)(swapMetrics);
                    }
                    else if (effectiveMode === "Mine and Swap") {
                        (0, print_1.printMessageLinesBorderBox)(["Mining Process:"], borderboxstyles_1.miningStyle);
                        await (0, runmining_1.runMining)(opPage, browser, mining);
                        (0, print_1.printMessageLinesBorderBox)(["Swap Process:"], borderboxstyles_1.swappingStyle);
                        const swapMetrics = await (0, runswap_1.runSwap)(opPage, browser, swap);
                        (0, metrics_1.accumulateSwapMetrics)(swapMetrics);
                    }
                    (0, print_1.printMessageLinesBorderBox)([`✅ Cycle ${cycleCount} complete`], borderboxstyles_1.generalStyle);
                }
            }
            (0, print_1.printMessageLinesBorderBox)(["🏁 Operation complete."], borderboxstyles_1.generalStyle);
            const endReport = {
                "Total Cycles": effectiveRounds > 0 ? effectiveRounds : "Infinite",
                "Successful Cycles": effectiveRounds > 0 ? effectiveRounds : "N/A",
                "Failed Attempts": 0,
                "Elapsed Time": "10m", // TODO: Calculate actual elapsed time if needed
                "Swap Metrics": metrics_1.overallMetrics.swapMetrics,
            };
            (0, print_1.printSessionEndReport)("End of Operation Report", endReport);
        }
        catch (cycleError) {
            console.error(chalk_1.default.red("Error during cycle execution:"), cycleError);
        }
        finally {
            if (browser) {
                await browser.close();
                (0, print_1.printMessageLinesBorderBox)(["🧹 Browser closed."], borderboxstyles_1.generalStyle);
            }
            process.stdin.removeAllListeners("data");
            if (process.stdin.isRaw)
                process.stdin.setRawMode(false);
            process.stdin.pause();
        }
    } // end outer while
}
async function promptContinueOrConfig(configs) {
    const width = 62;
    const line1 = (0, print_1.centerText)("Press 's' to view or modify configuration settings", width);
    const line2 = (0, print_1.centerText)("Press any other key to continue", width);
    process.stdout.write(line1 + "\n" + line2 + "\n");
    return new Promise((resolve) => {
        process.stdin.removeAllListeners("data");
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once("data", async (data) => {
            const char = data.toString().trim().toLowerCase();
            process.stdin.setRawMode(false);
            process.stdin.pause();
            console.log();
            if (char === "s") {
                const { view } = await inquirer_1.default.prompt({
                    type: "list",
                    name: "view",
                    message: chalk_1.default.bold.blue("👀  Do you want to view configuration settings? (y/n)"),
                    choices: ["y", "n"],
                    filter: (val) => val.toLowerCase(),
                });
                if (view === "y") {
                    (0, runsettings_1.showConfigurationSettings)(configs);
                }
                const { modify } = await inquirer_1.default.prompt({
                    type: "list",
                    name: "modify",
                    message: chalk_1.default.bold.blue("✏️  Do you want to modify any configuration settings? (y/n)"),
                    choices: ["y", "n"],
                    filter: (val) => val.toLowerCase(),
                });
                if (modify === "y") {
                    await (0, runsettings_1.modifyConfigurations)(configs);
                    (0, runsettings_1.showConfigurationSettings)(configs);
                }
                await inquirer_1.default.prompt({
                    type: "input",
                    name: "continue",
                    message: chalk_1.default.bold("🚀  Press Enter to continue to mode selection..."),
                });
                resolve(true);
            }
            else {
                resolve(false);
            }
        });
    });
}
async function waitForAnyKey(message = chalk_1.default.bold("Press any key to continue...")) {
    process.stdout.write(message);
    return new Promise((resolve) => {
        process.stdin.removeAllListeners("data");
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.once("data", () => {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            console.log("\n");
            resolve();
        });
    });
}
