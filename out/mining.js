"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MiningSession = void 0;
const helpers_1 = require("./utils/helpers");
const borderboxstyles_1 = require("./ui/styles/borderboxstyles");
const print_1 = require("./ui/print");
const pagehandlers_1 = require("./utils/pagehandlers");
const configloader_1 = require("./utils/configloader");
const mineMetricsDb_1 = require("./db/mineMetricsDb");
const phantom_1 = require("./phantom");
const swapping_1 = require("./swapping");
const miningConfig = (0, configloader_1.loadMiningConfig)();
/**
 * updatelcd:
 * Reads elements with the class "lcdbox" on the page,
 * parses their inner text, and returns an LCD object.
 */
const updatelcd = async (page) => {
    const lcd = await page.evaluate(() => {
        const LCD = {
            CONNECTION: null,
            STATUS: null,
            UNCLAIMED: null,
            TIME: null,
            HASHRATE: null,
            BOOST: null,
        };
        Array.from(document.querySelectorAll(".lcdbox")).forEach((v) => {
            const kv = v.innerText.replace(/\n/g, "").split(":");
            if (kv.length > 1 && kv[0] in LCD) {
                LCD[kv[0]] = kv[1] || null;
            }
        });
        return LCD;
    });
    return lcd;
};
/**
 * MiningSession:
 * Encapsulates the mining session functionality including:
 * - Initialization (delays, popups, and metric setup)
 * - Periodic LCD polling and metric updates
 * - Evaluation of claim conditions and performing stop/claim actions.
 */
class MiningSession {
    /**
     * Constructor for MiningSession.
     * @param page - The Puppeteer page instance.
     * @param browser - The Puppeteer browser instance.
     */
    constructor(page, browser) {
        this.sessionStartTime = 0;
        this.previousUpdateTime = 0;
        this.iterationCount = 0;
        this.prevReward = 0;
        this.boostRegistered = 0; // stores the first positive boost after iteration 5
        this.hashBoostOn = miningConfig.boostHash;
        this.hashBoosted = false;
        this.page = page;
        this.browser = browser;
    }
    /**
     * initSession:
     * Initializes the mining session by waiting for an initial delay,
     * triggering the mining popup, reading the initial LCD values,
     * and setting up the initial metrics.
     */
    async initSession() {
        (0, print_1.printMessageLinesBorderBox)(["Starting mining loop..."], borderboxstyles_1.miningStyle);
        await (0, helpers_1.d)(miningConfig.initialDelayMs);
        // Trigger the mining popup.
        await (0, phantom_1.handlephanpopup)(this.page, this.browser, miningConfig.confirmButtonText, miningConfig.mineButtonTrigger);
        await (0, helpers_1.d)(miningConfig.popupDelayMs);
        // Read initial LCD values and initialize metrics.
        const initialLCD = await updatelcd(this.page);
        this.sessionStartTime = Date.now();
        this.previousUpdateTime = this.sessionStartTime;
        const initialUnclaimed = (0, helpers_1.parseFormattedNumber)(initialLCD.UNCLAIMED || "0");
        this.metrics = {
            claimedAmount: 0,
            unclaimedAmount: initialUnclaimed,
            unclaimedIncrement: 0,
            avgHashRate: 0,
            miningTimeMin: 0,
            miningTimeIncrement: 0,
            maxBoost: 0,
            claimed: false,
            extraMiningData: {},
            incrementalExtraData: { checkCount: 0 },
        };
        // Mark initial flag for incremental data.
        this.metrics.incrementalExtraData.initial = 1;
        (0, mineMetricsDb_1.updateAggregatedMiningMetrics)(this.metrics);
        if (this.metrics.incrementalExtraData) {
            delete this.metrics.incrementalExtraData.initial;
        }
        this.prevReward = initialUnclaimed;
    }
    /**
     * updateMetrics:
     * Updates the in-memory metrics based on the latest LCD values.
     * Calculates changes in unclaimed tokens, hash rate, mining time,
     * and updates the maximum boost if applicable.
     * Also registers the first positive boost after iteration 5.
     * @param lcd - The current LCD values.
     */
    updateMetrics(lcd) {
        const tnum = parseInt(lcd.TIME) || 0;
        const hnum = parseFloat(lcd.HASHRATE) || 0;
        const unum = (0, helpers_1.parseFormattedNumber)(lcd.UNCLAIMED || "0");
        const statString = (0, helpers_1.parseString)(lcd.STATUS);
        const connectionString = (0, helpers_1.parseString)(lcd.CONNECTION);
        const bnum = lcd.BOOST ? parseFloat(lcd.BOOST) || 0 : 0;
        (0, print_1.printMessageLinesBorderBox)([
            `CONNECTION = ${connectionString}`,
            `STATUS = ${statString}`,
            `UNCLAIMED = ${unum}`,
            `TIME = ${tnum}`,
            `HASHRATE = ${hnum}`,
            `BOOST = ${bnum}`,
        ], borderboxstyles_1.miningStyle);
        this.metrics.unclaimedAmount = unum;
        // Update unclaimed metrics.
        if (unum > this.prevReward) {
            const diff = unum - this.prevReward;
            this.metrics.unclaimedIncrement = diff;
            (0, print_1.printMessageLinesBorderBox)([
                `Unclaimed increased from ${this.prevReward} to ${unum}.`,
                "Updating unclaimed increment and resetting iteration counter.",
            ], borderboxstyles_1.miningStyle);
            this.iterationCount = 0;
            this.prevReward = unum;
        }
        else {
            this.metrics.unclaimedIncrement = 0;
            this.iterationCount++;
        }
        // Update average hash rate.
        const previousCount = this.metrics.incrementalExtraData.checkCount;
        const newCount = previousCount + 1;
        this.metrics.avgHashRate =
            (this.metrics.avgHashRate * previousCount + hnum) / newCount;
        this.metrics.incrementalExtraData.checkCount = newCount;
        // Update mining time.
        const now = Date.now();
        this.metrics.miningTimeMin = parseFloat(((now - this.sessionStartTime) / 60000).toFixed(2));
        this.metrics.miningTimeIncrement = parseFloat(((now - this.previousUpdateTime) / 60000).toFixed(2));
        this.previousUpdateTime = now;
        // Update boost if a new maximum is detected.
        if (bnum > this.metrics.maxBoost) {
            (0, print_1.printMessageLinesBorderBox)([`New max boost detected: ${bnum}`], borderboxstyles_1.miningStyle);
            this.metrics.maxBoost = bnum;
        }
        // Register the first positive boost after iteration 5.
        if (this.iterationCount >= 5 && bnum > 0 && this.boostRegistered === 0) {
            this.boostRegistered = bnum;
            (0, print_1.printMessageLinesBorderBox)([`Registered boost value: ${bnum}`], borderboxstyles_1.miningStyle);
        }
        this.metrics.incrementalExtraData.iterations = this.iterationCount;
        (0, mineMetricsDb_1.updateAggregatedMiningMetrics)(this.metrics);
        // Reset incremental values.
        this.metrics.unclaimedIncrement = 0;
        this.metrics.miningTimeIncrement = 0;
        for (const key in this.metrics.incrementalExtraData) {
            if (key !== "final" && key !== "initial") {
                this.metrics.incrementalExtraData[key] = 0;
            }
        }
    }
    /**
     * triggerBoostAndSign:
     * Initiates the boost flow by:
     * 1. Clicking the initial Boost button.
     * 2. Clicking the boost amount button (passed as boostAmount).
     * 3. Clicking the secondary Boost button.
     * 4. Then waiting for and signing the transaction via the Phantom popup.
     *
     * @param boostAmount - The boost amount button's inner text (e.g., "0.1").
     */
    async triggerBoostAndSign(boostAmount) {
        try {
            (0, print_1.printMessageLinesBorderBox)(["Waiting for element..."], borderboxstyles_1.miningStyle);
            await (0, pagehandlers_1.waitforelement)(this.page, "button", "BOOST", 10000);
            (0, print_1.printMessageLinesBorderBox)(["Clicking initial Boost button..."], borderboxstyles_1.miningStyle);
            // Click the initial Boost button.
            const initialClicked = await (0, pagehandlers_1.clickbyinnertxt)(this.page, "button", "Boost");
            (0, print_1.printMessageLinesBorderBox)(["Initial Boost button clicked. Waiting for boost options..."], borderboxstyles_1.miningStyle);
            await (0, pagehandlers_1.waitforelement)(this.page, "button", miningConfig.boostHashAmountPerSession.toString(), 10000);
            // Click the boost amount button (e.g., "0.1").
            const amountClicked = await (0, pagehandlers_1.clickbyinnertxt)(this.page, "button", boostAmount);
            if (!amountClicked) {
                throw new Error(`Boost amount button "${boostAmount}" not found or not clickable.`);
            }
            (0, print_1.printMessageLinesBorderBox)([`Boost amount button "${boostAmount}" clicked.`], borderboxstyles_1.miningStyle);
            // Click the secondary Boost button that confirms the boost option.
            const secondaryClicked = await (0, pagehandlers_1.clickbyinnertxt)(this.page, "button", "Boost");
            if (!secondaryClicked) {
                throw new Error("Secondary Boost button not found or not clickable.");
            }
            (0, print_1.printMessageLinesBorderBox)(["Secondary Boost button clicked. Awaiting signature popup..."], borderboxstyles_1.miningStyle);
            // Now wait for the signature popup and sign the transaction using your existing logic.
            const result = await (0, swapping_1.signtxloop)(this.page, this.browser);
            if (result.success) {
                (0, print_1.printMessageLinesBorderBox)(["✅ Boost transaction approved."], borderboxstyles_1.miningStyle);
            }
            else {
                (0, print_1.printMessageLinesBorderBox)([`❌ Boost signature failed: ${result.errorType}`], borderboxstyles_1.warningStyle);
            }
            // Click the secondary Boost button that confirms the boost option.
            const boostWindowClosed = await (0, pagehandlers_1.clickbyinnertxt)(this.page, "button", "Close");
            if (!boostWindowClosed) {
                throw new Error("Hash boost pop-up could not be closed.");
            }
            (0, print_1.printMessageLinesBorderBox)(["Hash boost pop-up closed..."], borderboxstyles_1.miningStyle);
        }
        catch (error) {
            (0, print_1.printMessageLinesBorderBox)([
                "⚠️ Error during boost and sign flow:",
                String(error.message || error),
            ], borderboxstyles_1.warningStyle);
        }
    }
    /**
     * stopAndClaim:
     * Helper function to stop the mining session and claim tokens.
     * Updates the metrics with the claimed token amount, logs an optional
     * success message, and simulates the click on the stop/claim button.
     * @param tokens - The amount of tokens to claim.
     * @param successMessage - Optional message to log on successful claim.
     * @returns Promise<boolean> - Resolves to true upon completion.
     */
    async stopAndClaim(tokens, successMessage) {
        this.metrics.claimedAmount = tokens;
        this.metrics.claimed = true;
        if (successMessage) {
            (0, print_1.printMessageLinesBorderBox)([successMessage], borderboxstyles_1.miningStyle);
        }
        await (0, pagehandlers_1.clickbyinnertxt)(this.page, "button", [
            miningConfig.stopClaimButtonText,
            miningConfig.stopAnywayButtonText,
        ]);
        (0, helpers_1.d)(miningConfig.miningSuccessDelayMs);
        return true;
    }
    /**
     * checkMaxIterations:
     * Checks if the maximum number of iterations has been reached.
     * If so, attempts to claim tokens if the unclaimed amount exceeds the minimum threshold,
     * logs appropriate messages, and returns true to indicate the session should end.
     * @returns Promise<boolean>
     */
    async checkMaxIterations() {
        if (this.iterationCount > miningConfig.maxIterations) {
            (0, print_1.printMessageLinesBorderBox)([
                "Max iterations reached.",
                `Unclaimed tokens: ${this.metrics.unclaimedAmount}.`,
                "Attempting to claim if tokens available...",
            ], borderboxstyles_1.miningStyle);
            if (this.metrics.unclaimedAmount >
                miningConfig.miningCompleteUnclaimedThreshold) {
                try {
                    return await this.stopAndClaim(this.metrics.unclaimedAmount, `Successfully claimed ${this.metrics.unclaimedAmount} tokens.`);
                }
                catch (error) {
                    (0, print_1.printMessageLinesBorderBox)(["Claim attempt failed:", "Ending session anyway."], borderboxstyles_1.warningStyle);
                    this.metrics.claimed = false;
                    return true;
                }
            }
            else {
                (0, print_1.printMessageLinesBorderBox)(["Not enough tokens to claim.", "Ending session without claiming."], borderboxstyles_1.miningStyle);
                this.metrics.claimed = false;
                return true;
            }
        }
        return false;
    }
    /**
     * checkClaimMaxThreshold:
     * Checks if the unclaimed token amount exceeds the maximum claim threshold.
     * Logs final metrics using printMessageLinesBorderBox and attempts to claim tokens.
     * @param unum - The current unclaimed token amount.
     * @returns Promise<boolean>
     */
    async checkClaimMaxThreshold(unum) {
        if (unum >= miningConfig.claimMaxThreshold) {
            (0, print_1.printMessageLinesBorderBox)(["Max claim condition met:"], borderboxstyles_1.miningStyle);
            (0, print_1.printMessageLinesBorderBox)([
                "Final Metrics before Claim:",
                ` - Unclaimed Amount: ${unum}`,
                ` - Claimed Amount set to: ${unum}`,
                ` - Average Hash Rate: ${this.metrics.avgHashRate}`,
                ` - Mining Time (min): ${this.metrics.miningTimeMin}`,
                ` - Max Boost: ${this.metrics.maxBoost}`,
            ], borderboxstyles_1.miningStyle);
            return await this.stopAndClaim(unum);
        }
        return false;
    }
    /**
     * checkZeroHashRateStart:
     * Checks if the hash rate remains zero for several iterations.
     * If true, stops the session.
     * @param hnum - The current hash rate.
     * @returns Promise<boolean>
     */
    async checkZeroHashRateStart(hnum) {
        if (this.iterationCount > 5 && hnum === 0) {
            (0, print_1.printMessageLinesBorderBox)(["Hash rate is 0.", "Stopping mining session"], borderboxstyles_1.miningStyle);
            this.metrics.claimed = false;
            return true;
        }
        return false;
    }
    /**
     * checkTimeThreshold:
     * Checks if the time threshold for claiming tokens has been reached.
     * If the unclaimed tokens are below the minimum threshold, stops the session;
     * otherwise, attempts to claim tokens.
     * @param tnum - The current time value.
     * @param unum - The current unclaimed token amount.
     * @returns Promise<boolean>
     */
    async checkTimeThreshold(tnum, unum) {
        if (tnum >= miningConfig.claimTimeThreshold) {
            if (unum < miningConfig.miningCompleteUnclaimedThreshold) {
                (0, print_1.printMessageLinesBorderBox)(["Time limit reached but unclaimed is below the minimum threshold."], borderboxstyles_1.miningStyle);
                this.metrics.claimed = false;
                return true;
            }
            else {
                (0, print_1.printMessageLinesBorderBox)(["Time limit reached and unclaimed meets the minimum threshold."], borderboxstyles_1.miningStyle);
                return await this.stopAndClaim(unum);
            }
        }
        return false;
    }
    /**
     * checkZeroHashRateEnd:
     * Checks the primary claim condition based on hash rate and unclaimed token thresholds.
     * If met, attempts to claim tokens.
     * @param hnum - The current hash rate.
     * @param unum - The current unclaimed token amount.
     * @returns Promise<boolean>
     */
    async checkZeroHashRateEnd(hnum, unum) {
        if (hnum === miningConfig.miningCompleteHashRate &&
            unum > miningConfig.miningCompleteUnclaimedThreshold) {
            (0, print_1.printMessageLinesBorderBox)(["Primary claim condition met."], borderboxstyles_1.miningStyle);
            return await this.stopAndClaim(unum);
        }
        return false;
    }
    /**
     * checkBoost:
     * Checks if a positive boost was previously registered (via maxBoost) and if,
     * after at least 5 iterations, the current boost value drops below that registered value.
     * If so, triggers a claim action.
     * @param lcd - The current LCD values.
     * @returns Promise<boolean>
     */
    async checkBoost(lcd) {
        const bnum = lcd.BOOST ? parseFloat(lcd.BOOST) || 0 : 0;
        // Only trigger boost claim if a positive boost was registered and we're past iteration 5.
        if (this.iterationCount >= 5 &&
            this.metrics.maxBoost > 0 &&
            bnum < this.metrics.maxBoost) {
            (0, print_1.printMessageLinesBorderBox)([
                `Boost dropped from recorded maximum ${this.metrics.maxBoost} to ${bnum}.`,
                "Claiming tokens because boost has dropped below its maximum.",
            ], borderboxstyles_1.miningStyle);
            const unum = (0, helpers_1.parseFormattedNumber)(lcd.UNCLAIMED || "0");
            return await this.stopAndClaim(unum);
        }
        return false;
    }
    /**
     * checkClaimConditions:
     * Evaluates all claim conditions sequentially using helper methods.
     * Returns true if any condition is met and a claim or stop action is executed.
     * @param lcd - The current LCD values.
     * @returns Promise<boolean>
     */
    async checkClaimConditions(lcd) {
        const tnum = parseInt(lcd.TIME) || 0;
        const hnum = parseFloat(lcd.HASHRATE) || 0;
        const unum = (0, helpers_1.parseFormattedNumber)(lcd.UNCLAIMED || "0");
        if (await this.checkMaxIterations())
            return true;
        if (await this.checkClaimMaxThreshold(unum))
            return true;
        if (await this.checkZeroHashRateStart(hnum))
            return true;
        if (await this.checkTimeThreshold(tnum, unum))
            return true;
        if (await this.checkZeroHashRateEnd(hnum, unum))
            return true;
        if (await this.checkBoost(lcd))
            return true;
        return false;
    }
    /**
     * start:
     * Starts the mining session by initializing the session, entering the loop to
     * periodically poll LCD values, update metrics, and evaluate claim conditions.
     * Finalizes metrics once a claim or stop condition is met.
     * @returns Promise<boolean> - Resolves to true when the session completes.
     */
    async start() {
        await this.initSession();
        let mineComplete = false;
        try {
            while (!mineComplete) {
                // Ensure incrementalExtraData exists.
                if (!this.metrics.incrementalExtraData) {
                    this.metrics.incrementalExtraData = { checkCount: 0 };
                }
                // Read the latest LCD values.
                const lcd = await updatelcd(this.page);
                this.updateMetrics(lcd);
                // --- NEW: Trigger boost & sign action once after 5 iterations ---
                if (!this.hashBoosted && this.iterationCount >= 1 && this.hashBoostOn) {
                    await this.triggerBoostAndSign(miningConfig.boostHashAmountPerSession.toString());
                    this.hashBoosted = true;
                }
                // ----------------------------------------------------------
                // Evaluate claim conditions.
                mineComplete = await this.checkClaimConditions(lcd);
                if (!mineComplete) {
                    await (0, helpers_1.d)(miningConfig.loopIterationDelayMs);
                }
            }
        }
        finally {
            if (!this.metrics.incrementalExtraData) {
                this.metrics.incrementalExtraData = {};
            }
            this.metrics.incrementalExtraData.final = 1;
            (0, mineMetricsDb_1.updateAggregatedMiningMetrics)(this.metrics);
            await (0, helpers_1.d)(500);
        }
        return true;
    }
}
exports.MiningSession = MiningSession;
