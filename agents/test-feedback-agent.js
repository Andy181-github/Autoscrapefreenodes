/**
 * 测试反馈 Agent
 * 职责: 分析测试结果，提供改进建议和反馈
 */

class TestFeedbackAgent {
  constructor() {
    this.testHistory = [];
    // 注意: totalTests 是单次测试运行的计数; passed/failed/skipped 是跨运行累计
    // (每次 _generateSummary 都会把本次的通过/失败/跳过累加进 performanceMetrics,
    //  用于趋势与统计, 不重置。reset() 可清空这些累计值)。
    this.performanceMetrics = {
      totalTests: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      avgDuration: 0,
      trends: []
    };
  }

  /**
   * 重置累计性能指标 (保留 testHistory)
   */
  reset() {
    this.performanceMetrics.passed = 0;
    this.performanceMetrics.failed = 0;
    this.performanceMetrics.skipped = 0;
  }

  /**
   * 分析测试结果
   */
  analyzeResults(testResults) {
    console.log('\n[TestFeedback] 分析测试结果...');

    const analysis = {
      summary: this._generateSummary(testResults),
      failureAnalysis: this._analyzeFailures(testResults),
      performanceAnalysis: this._analyzePerformance(testResults),
      coverageAnalysis: this._analyzeCoverage(testResults),
      recommendations: this._generateRecommendations(testResults)
    };

    // 记录到历史
    this.testHistory.push({
      timestamp: new Date().toISOString(),
      results: testResults,
      analysis: analysis
    });

    return analysis;
  }

  /**
   * 生成测试摘要
   */
  _generateSummary(results) {
    const total = results.tests?.length || 0;
    const passed = results.tests?.filter(t => t.status === 'passed').length || 0;
    const failed = results.tests?.filter(t => t.status === 'failed').length || 0;
    const skipped = results.tests?.filter(t => t.status === 'skipped').length || 0;

    this.performanceMetrics = {
      totalTests: total,
      passed: this.performanceMetrics.passed + passed,
      failed: this.performanceMetrics.failed + failed,
      skipped: this.performanceMetrics.skipped + skipped,
      avgDuration: results.duration || 0
    };

    return {
      total,
      passed,
      failed,
      skipped,
      passRate: total > 0 ? (passed / total * 100).toFixed(2) + '%' : '0%',
      trend: this._calculateTrend()
    };
  }

  /**
   * 分析失败用例
   */
  _analyzeFailures(results) {
    const failures = results.tests?.filter(t => t.status === 'failed') || [];
    
    const analysis = {
      totalCount: failures.length,
      byCategory: {},
      rootCauses: [],
      patterns: []
    };

    // 按分类统计失败
    failures.forEach(failure => {
      const category = failure.category || 'unknown';
      analysis.byCategory[category] = (analysis.byCategory[category] || 0) + 1;
      
      // 分析根因
      if (failure.error) {
        const rootCause = this._identifyRootCause(failure.error);
        if (rootCause && !analysis.rootCauses.includes(rootCause)) {
          analysis.rootCauses.push(rootCause);
        }
      }
    });

    // 识别模式
    analysis.patterns = this._identifyFailurePatterns(failures);

    return analysis;
  }

  /**
   * 分析性能指标
   * 注意: 输入 testResults 的 duration 字段单位为毫秒 (与外部调用约定一致);
   * 内部 _gradePerformance 期望秒, 因此在下方调用处显式换算。
   */
  _analyzePerformance(results) {
    const totalDurationMs = results.duration || 0;
    const tests = results.tests || [];

    // 计算平均测试时长 (毫秒)
    const durations = tests.map(t => t.duration || 0);
    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    // 排序副本, 避免修改调用方传入的数组
    const slowestTests = [...tests]
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, 5);
    const totalDurationSec = totalDurationMs / 1000;

    return {
      totalDuration: totalDurationMs,
      avgDuration: avgDuration,
      slowestTests,
      performanceGrade: this._gradePerformance(totalDurationSec, tests.length)
    };
  }

  /**
   * 分析测试覆盖率
   */
  _analyzeCoverage(results) {
    const tests = results.tests || [];
    
    // 按模块统计
    const moduleCoverage = {};
    tests.forEach(test => {
      const module = test.module || 'default';
      if (!moduleCoverage[module]) {
        moduleCoverage[module] = { total: 0, passed: 0, failed: 0 };
      }
      moduleCoverage[module].total++;
      if (test.status === 'passed') {
        moduleCoverage[module].passed++;
      } else if (test.status === 'failed') {
        moduleCoverage[module].failed++;
      }
    });

    // 计算覆盖率
    const coverage = {};
    Object.entries(moduleCoverage).forEach(([module, stats]) => {
      coverage[module] = {
        ...stats,
        passRate: stats.total > 0 
          ? (stats.passed / stats.total * 100).toFixed(2) + '%' 
          : '0%'
      };
    });

    return {
      modules: coverage,
      overallPassRate: this._calculateOverallPassRate(tests)
    };
  }

  /**
   * 生成改进建议
   */
  _generateRecommendations(results) {
    const recommendations = [];
    const failures = results.tests?.filter(t => t.status === 'failed') || [];
    
    // 基于失败类型给出建议
    failures.forEach(failure => {
      if (failure.error?.includes('timeout')) {
        recommendations.push({
          type: 'performance',
          priority: 'high',
          message: `测试超时: ${failure.name}`,
          suggestion: '检查超时设置或优化被测功能'
        });
      }
      
      if (failure.error?.includes('not defined')) {
        recommendations.push({
          type: 'code_quality',
          priority: 'critical',
          message: `未定义函数: ${failure.name}`,
          suggestion: '检查函数定义和导入'
        });
      }
    });

    // 基于覆盖率给出建议
    const coverage = this._analyzeCoverage(results);
    if (coverage.overallPassRate < 90) {
      recommendations.push({
        type: 'coverage',
        priority: 'medium',
        message: `测试覆盖率较低: ${coverage.overallPassRate}`,
        suggestion: '增加边界条件和异常场景测试'
      });
    }

    // 按优先级排序
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return recommendations;
  }

  /**
   * 计算趋势
   */
  _calculateTrend() {
    if (this.performanceMetrics.totalTests < 2) return 'stable';
    
    const recent = this.performanceMetrics.trends.slice(-5);
    const avgPassRate = recent.reduce((sum, t) => sum + t.passRate, 0) / recent.length;
    
    if (avgPassRate > 95) return 'excellent';
    if (avgPassRate > 85) return 'good';
    if (avgPassRate > 70) return 'fair';
    return 'poor';
  }

  /**
   * 识别失败根因
   */
  _identifyRootCause(error) {
    if (!error) return 'unknown';
    const errorStr = error.toString().toLowerCase();
    
    if (errorStr.includes('timeout')) return 'timeout';
    if (errorStr.includes('not defined') || errorStr.includes('undefined')) return 'undefined_reference';
    if (errorStr.includes('type error')) return 'type_error';
    if (errorStr.includes('syntax error')) return 'syntax_error';
    if (errorStr.includes('network') || errorStr.includes('connection')) return 'network_error';
    if (errorStr.includes('permission')) return 'permission_error';
    
    return 'unknown';
  }

  /**
   * 识别失败模式
   */
  _identifyFailurePatterns(failures) {
    const patterns = [];
    const rootCauses = failures.map(f => this._identifyRootCause(f.error));
    
    // 统计根因频率
    const causeFrequency = {};
    rootCauses.forEach(cause => {
      causeFrequency[cause] = (causeFrequency[cause] || 0) + 1;
    });

    // 识别高频模式
    Object.entries(causeFrequency)
      .filter(([_, count]) => count >= 2)
      .forEach(([cause, count]) => {
        patterns.push({ cause, frequency: count, affected: count });
      });

    return patterns;
  }

  /**
   * 评估性能等级
   * 注意: duration 单位为秒 (调用方在 _analyzePerformance 中显式从毫秒换算);
   * 每个测试平均耗时 < 0.1s → A+, < 0.5s → A, < 1s → B, < 2s → C, 否则 D。
   */
  _gradePerformance(duration, testCount) {
    const avgPerTest = duration / testCount;
    
    if (avgPerTest < 0.1) return 'A+';
    if (avgPerTest < 0.5) return 'A';
    if (avgPerTest < 1) return 'B';
    if (avgPerTest < 2) return 'C';
    return 'D';
  }

  /**
   * 计算总体通过率
   */
  _calculateOverallPassRate(tests) {
    if (!tests || tests.length === 0) return '0%';
    const passed = tests.filter(t => t.status === 'passed').length;
    return (passed / tests.length * 100).toFixed(2) + '%';
  }

  /**
   * 生成详细报告
   */
  generateReport(results) {
    const analysis = this.analyzeResults(results);
    
    return {
      title: '测试反馈报告',
      generatedAt: new Date().toISOString(),
      summary: analysis.summary,
      failureAnalysis: analysis.failureAnalysis,
      performanceAnalysis: analysis.performanceAnalysis,
      coverageAnalysis: analysis.coverageAnalysis,
      recommendations: analysis.recommendations,
      actionItems: this._generateActionItems(analysis)
    };
  }

  /**
   * 生成行动项
   */
  _generateActionItems(analysis) {
    const actions = [];
    
    // 基于失败分析
    if (analysis.failureAnalysis.totalCount > 0) {
      actions.push({
        type: 'fix',
        priority: 'high',
        description: `修复 ${analysis.failureAnalysis.totalCount} 个失败测试`,
        details: analysis.failureAnalysis.rootCauses
      });
    }

    // 基于性能分析
    if (analysis.performanceAnalysis.performanceGrade === 'D') {
      actions.push({
        type: 'optimize',
        priority: 'medium',
        description: '优化测试性能',
        details: ['检查超时设置', '优化批量操作']
      });
    }

    // 基于覆盖率
    if (parseFloat(analysis.coverageAnalysis.overallPassRate) < 90) {
      actions.push({
        type: 'expand',
        priority: 'medium',
        description: '扩大测试覆盖范围',
        details: ['添加边界条件测试', '增加异常场景测试']
      });
    }

    return actions;
  }

  /**
   * 获取历史趋势
   */
  getTrends() {
    return this.performanceMetrics.trends;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalRuns: this.testHistory.length,
      metrics: this.performanceMetrics,
      lastRun: this.testHistory[this.testHistory.length - 1]
    };
  }
}

module.exports = new TestFeedbackAgent();
