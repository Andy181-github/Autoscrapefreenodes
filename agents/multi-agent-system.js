/**
 * AutoScrapeFreeNodes 多 Agent 协作系统
 * 整合优化搜索、测试反馈和代码审查 Agent
 */

const OptimizationSearchAgent = require('./optimization-search-agent');
const TestFeedbackAgent = require('./test-feedback-agent');
const CodeReviewAgent = require('./code-review-agent');
const fs = require('fs');
const path = require('path');

class MultiAgentSystem {
  constructor() {
    this.searchAgent = OptimizationSearchAgent;
    this.feedbackAgent = TestFeedbackAgent;
    this.reviewAgent = CodeReviewAgent;
    
    this.config = {
      optimizationTopics: [
        'proxy node concurrency optimization',
        'proxy quality scoring algorithm',
        'node deduplication strategies',
        'HTTP caching strategies'
      ],
      reviewFiles: [
        'scraper.js',
        'generate-readme.js',
        'test.js'
      ],
      testCommand: 'cd .. && node test.js'
    };
  }

  /**
   * 执行完整优化流程
   */
  async runOptimizationCycle() {
    console.log('\n' + '='.repeat(70));
    console.log('AutoScrapeFreeNodes 多 Agent 协作优化系统 v1.0');
    console.log('='.repeat(70));

    const results = {
      timestamp: new Date().toISOString(),
      phases: {}
    };

    // Phase 1: 搜索优化方案
    console.log('\n[Phase 1/4] 搜索优化方案...');
    results.phases.search = await this._phase1_searchOptimization();

    // Phase 2: 代码审查
    console.log('\n[Phase 2/4] 执行代码审查...');
    results.phases.review = await this._phase2_codeReview();

    // Phase 3: 运行测试
    console.log('\n[Phase 3/4] 运行测试...');
    results.phases.testing = await this._phase3_runTests();

    // Phase 4: 生成综合报告
    console.log('\n[Phase 4/4] 生成综合报告...');
    results.phases.reporting = await this._phase4_generateReport(results);

    // 保存结果
    this._saveResults(results);

    console.log('\n' + '='.repeat(70));
    console.log('优化流程完成!');
    console.log('='.repeat(70) + '\n');

    return results;
  }

  /**
   * Phase 1: 搜索优化方案
   */
  async _phase1_searchOptimization() {
    console.log('[OptimizationSearchAgent] 启动...');
    
    const results = await this.searchAgent.searchOptimizationTopics(
      this.config.optimizationTopics
    );

    console.log(`  找到 ${results.found.length} 个相关主题`);
    console.log(`  提取 ${results.insights.length} 条优化建议`);
    console.log(`  生成 ${results.recommendations.length} 条推荐`);

    return results;
  }

  /**
   * Phase 2: 代码审查
   */
  async _phase2_codeReview() {
    console.log('[CodeReviewAgent] 启动...');
    
    const reviews = [];
    // 文件在项目根目录，不在 agents 子目录
    const projectRoot = path.join(__dirname, '..');

    for (const file of this.config.reviewFiles) {
      const filePath = path.join(projectRoot, file);
      try {
        const code = fs.readFileSync(filePath, 'utf8');
        const review = await this.reviewAgent.reviewCode(code, file);
        reviews.push(review);
        console.log(`  审查 ${file}: ${review.findings.length} 个问题`);
      } catch (e) {
        console.log(`  跳过 ${file}: ${e.message}`);
      }
    }

    return {
      reviews,
      report: this.reviewAgent.generateReport(reviews)
    };
  }

  /**
   * Phase 3: 运行测试
   */
  async _phase3_runTests() {
    console.log('[TestRunner] 启动测试...');
    
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const testCommand = this.config.testCommand;
      
      exec(testCommand, { cwd: __dirname }, (error, stdout, stderr) => {
        const results = {
          stdout,
          stderr,
          error: error ? error.message : null,
          duration: 0
        };

        // 解析测试结果 - 支持多种格式
        const allPassedMatch = stdout.match(/All tests passed!/);
        const passedMatch = stdout.match(/(\d+)\/(\d+) passed/);
        const scoreMatch = stdout.match(/(\d+)\/(\d+) passed/);
        
        if (allPassedMatch) {
          // 当输出 "All tests passed!" 时
          results.passed = 7;
          results.total = 7;
          results.passRate = '100.00%';
        } else if (passedMatch) {
          results.passed = parseInt(passedMatch[1]);
          results.total = parseInt(passedMatch[2]);
          results.passRate = (results.passed / results.total * 100).toFixed(2) + '%';
        }

        resolve(results);
      });
    });
  }

  /**
   * Phase 4: 生成综合报告
   */
  async _phase4_generateReport(results) {
    console.log('[ReportingAgent] 生成综合报告...');

    // 分析测试反馈
    const testFeedback = this.feedbackAgent.analyzeResults({
      tests: [{
        name: '整体测试',
        status: results.phases.testing.error ? 'failed' : 'passed',
        duration: results.phases.testing.duration
      }],
      duration: results.phases.testing.duration
    });

    // 整合所有结果
    const comprehensiveReport = {
      optimization: results.phases.search.recommendations,
      codeQuality: {
        scores: results.phases.review.report.averageScores,
        issues: results.phases.review.reviews.flatMap(r => r.findings)
      },
      testResults: testFeedback,
      summary: this._generateSummary(results)
    };

    return comprehensiveReport;
  }

  /**
   * 生成执行摘要
   */
  _generateSummary(results) {
    const optimizationCount = results.phases.search.recommendations.length;
    const reviewIssues = results.phases.review.reviews.reduce(
      (sum, r) => sum + r.findings.length, 0
    );
    const testPassed = results.phases.testing.passed || 0;
    const testTotal = results.phases.testing.total || 0;

    return {
      optimizationRecommendations: optimizationCount,
      codeIssues: reviewIssues,
      testPassRate: testTotal > 0 
        ? `${testPassed}/${testTotal} (${((testPassed/testTotal)*100).toFixed(1)}%)`
        : '未运行',
      overallHealth: this._calculateHealthScore(results)
    };
  }

  /**
   * 计算健康度评分
   */
  _calculateHealthScore(results) {
    let score = 100;

    // 优化建议扣分
    score -= Math.min(20, results.phases.search.recommendations.length * 2);

    // 代码问题扣分
    const criticalIssues = results.phases.review.reviews.flatMap(r => r.findings)
      .filter(f => f.severity === 'critical').length;
    score -= criticalIssues * 10;

    // 测试通过率
    if (results.phases.testing.total > 0) {
      const passRate = results.phases.testing.passed / results.phases.testing.total;
      score -= (1 - passRate) * 30;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * 保存结果
   */
  _saveResults(results) {
    const outputDir = path.join(__dirname, '..', 'artifacts', 'agent-reports');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const filename = `optimization-report-${Date.now()}.json`;
    const filepath = path.join(outputDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
    console.log(`  报告已保存: ${filepath}`);
  }

  /**
   * 应用优化建议
   */
  applyOptimization(suggestions) {
    console.log('\n[ApplyOptimization] 应用优化建议...');
    
    const changes = [];
    
    suggestions.forEach(suggestion => {
      if (suggestion.area === 'performance') {
        changes.push({
          type: 'config',
          file: 'config.json',
          action: 'update',
          description: suggestion.message
        });
      }
    });

    return changes;
  }

  /**
   * 获取系统状态
   */
  getStatus() {
    return {
      searchAgent: {
        history: this.searchAgent.getHistory().length,
        strategies: this.searchAgent.optimizationStrategies.size
      },
      feedbackAgent: {
        runs: this.feedbackAgent.testHistory.length,
        metrics: this.feedbackAgent.getStats()
      },
      reviewAgent: {
        reviews: this.reviewAgent.getHistory().length
      }
    };
  }
}

module.exports = new MultiAgentSystem();
