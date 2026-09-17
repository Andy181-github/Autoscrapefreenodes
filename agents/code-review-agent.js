/**
 * 代码审查 Agent
 * 职责: 审查代码质量，发现潜在问题和优化点
 */

class CodeReviewAgent {
  constructor() {
    this.reviewHistory = [];
    // 静态规则审查 (rule-based static review): 基于内置 checklist 的启发式检查,
    // 不依赖外部 LLM; 升级 LLM 审查时可在此处注入 provider 配置。
    this.checklist = this._loadChecklist();
  }

  /**
   * 加载审查清单
   */
  _loadChecklist() {
    return {
      codeQuality: [
        '是否存在重复代码',
        '函数是否过于复杂',
        '变量命名是否清晰',
        '注释是否充分',
        '代码风格是否一致'
      ],
      performance: [
        '是否存在性能瓶颈',
        '是否合理使用缓存',
        '是否有不必要的计算',
        '内存使用是否合理',
        '并发处理是否适当'
      ],
      security: [
        '是否有输入验证',
        '敏感信息是否加密',
        '是否存在注入风险',
        '依赖包是否安全',
        '错误处理是否恰当'
      ],
      reliability: [
        '是否有适当的错误处理',
        '边界条件是否处理',
        '异常是否被捕获',
        '是否有日志记录',
        '资源是否被正确释放'
      ],
      maintainability: [
        '代码结构是否清晰',
        '模块耦合度是否合理',
        '是否有适当的抽象',
        '是否易于测试',
        '文档是否完整'
      ]
    };
  }

  /**
   * 执行代码审查
   */
  async reviewCode(code, filePath, options = {}) {
    console.log(`\n[CodeReview] 开始审查: ${filePath}`);
    
    const review = {
      file: filePath,
      timestamp: new Date().toISOString(),
      findings: [],
      summary: {
        critical: 0,
        warning: 0,
        info: 0,
        suggestions: 0
      },
      scores: {},
      recommendations: []
    };

    // 执行各项检查
    const checks = [
      () => this._checkCodeQuality(code, filePath),
      () => this._checkPerformance(code, filePath),
      () => this._checkSecurity(code, filePath),
      () => this._checkReliability(code, filePath),
      () => this._checkMaintainability(code, filePath)
    ];

    for (const check of checks) {
      const results = await check();
      review.findings.push(...results);
    }

    // 计算评分
    review.scores = this._calculateScores(review.findings);
    review.summary = this._generateSummary(review.findings);

    // 生成建议
    review.recommendations = this._generateRecommendations(review.findings, review.scores);

    // 记录审查历史
    this.reviewHistory.push(review);

    console.log(`[CodeReview] 完成审查: ${filePath}`);
    console.log(`  发现问题: ${review.findings.length} 个`);
    console.log(`  评分: ${JSON.stringify(review.scores)}`);

    return review;
  }

  /**
   * 检查代码质量
   */
  _checkCodeQuality(code, filePath) {
    const findings = [];
    const lines = code.split('\n');

    // 检查重复代码
    const functionPatterns = {};
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('function ') || trimmed.startsWith('const ') || trimmed.startsWith('async ')) {
        const pattern = trimmed.substring(0, 50);
        if (functionPatterns[pattern]) {
          findings.push({
            type: 'duplicate',
            severity: 'warning',
            line: index + 1,
            message: `可能的重复代码: ${pattern}...`,
            category: 'code_quality'
          });
        }
        functionPatterns[pattern] = (functionPatterns[pattern] || 0) + 1;
      }
    });

    // 检查注释密度
    const commentLines = lines.filter(l => l.trim().startsWith('//') || l.trim().startsWith('*') || l.trim().startsWith('/*'));
    const commentRatio = commentLines.length / lines.length;
    if (commentRatio < 0.05 && lines.length > 100) {
      findings.push({
        type: 'low_comments',
        severity: 'info',
        message: `注释密度较低: ${(commentRatio * 100).toFixed(1)}%`,
        category: 'code_quality'
      });
    }

    return findings;
  }

  /**
   * 检查性能问题
   */
  _checkPerformance(code, filePath) {
    const findings = [];

    // 检查循环中的异步操作
    const asyncInLoopPattern = /for\s*\(.*\)\s*\{[\s\S]*?await\s+/g;
    if (asyncInLoopPattern.test(code)) {
      findings.push({
        type: 'async_in_loop',
        severity: 'critical',
        message: '检测到循环中的异步操作，可能导致性能问题',
        category: 'performance',
        suggestion: '使用 Promise.all 或批次处理'
      });
    }

    // 检查大数组操作
    if (code.includes('.slice()') || code.includes('.splice()')) {
      findings.push({
        type: 'array_operation',
        severity: 'warning',
        message: '检测到数组切片操作，注意内存使用',
        category: 'performance'
      });
    }

    // 检查正则表达式编译
    const regexInFunctionPattern = /function.*\{[\s\S]*?new\s+RegExp/g;
    if (regexInFunctionPattern.test(code)) {
      findings.push({
        type: 'regex_compilation',
        severity: 'warning',
        message: '函数内重复编译正则表达式，建议提升到全局',
        category: 'performance',
        suggestion: '将正则表达式定义为常量'
      });
    }

    return findings;
  }

  /**
   * 检查安全问题
   */
  _checkSecurity(code, filePath) {
    const findings = [];

    // 检查硬编码敏感信息
    const hardcodedPatterns = [
      /password\s*[:=]\s*['"][^'"]+['"]/i,
      /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i,
      /secret\s*[:=]\s*['"][^'"]+['"]/i,
      /token\s*[:=]\s*['"][^'"]+['"]/i
    ];

    hardcodedPatterns.forEach(pattern => {
      if (pattern.test(code)) {
        findings.push({
          type: 'hardcoded_secret',
          severity: 'critical',
          message: '检测到可能的硬编码敏感信息',
          category: 'security',
          suggestion: '使用环境变量或配置文件'
        });
      }
    });

    // 检查 eval 使用
    if (code.includes('eval(')) {
      findings.push({
        type: 'eval_usage',
        severity: 'critical',
        message: '检测到 eval() 使用，存在安全风险',
        category: 'security',
        suggestion: '使用 JSON.parse 或其他安全方法'
      });
    }

    // 检查 SQL 注入风险（虽然这是 JS 项目）
    if (code.includes('SELECT') && code.includes('FROM')) {
      findings.push({
        type: 'sql_injection_risk',
        severity: 'warning',
        message: '检测到可能的 SQL 查询，注意参数化',
        category: 'security'
      });
    }

    return findings;
  }

  /**
   * 检查可靠性
   */
  _checkReliability(code, filePath) {
    const findings = [];

    // 检查错误处理
    const tryCatchCount = (code.match(/try\s*\{/g) || []).length;
    const catchCount = (code.match(/catch\s*\(/g) || []).length;
    
    if (tryCatchCount > 0 && catchCount === 0) {
      findings.push({
        type: 'missing_catch',
        severity: 'warning',
        message: '存在 try 块但没有对应的 catch',
        category: 'reliability'
      });
    }

    // 检查未处理的 Promise
    const promiseChains = (code.match(/\.then\(/g) || []).length;
    const promiseCatches = (code.match(/\.catch\(/g) || []).length;
    
    if (promiseChains > promiseCatches) {
      findings.push({
        type: 'unhandled_promise',
        severity: 'warning',
        message: '可能存在未处理的 Promise 错误',
        category: 'reliability',
        suggestion: '为所有 Promise 链添加 .catch()'
      });
    }

    // 检查资源释放
    if (code.includes('fs.createReadStream') || code.includes('net.connect')) {
      if (!code.includes('.destroy()') && !code.includes('.close()')) {
        findings.push({
          type: 'resource_leak',
          severity: 'warning',
          message: '检测到可能未释放的资源',
          category: 'reliability',
          suggestion: '确保在使用后释放资源'
        });
      }
    }

    return findings;
  }

  /**
   * 检查可维护性
   */
  _checkMaintainability(code, filePath) {
    const findings = [];
    const lines = code.split('\n');

    // 检查函数长度
    const functions = [];
    let currentFunction = null;
    let braceCount = 0;

    lines.forEach((line, index) => {
      if (line.match(/^(async\s+)?function\s+\w+/) || line.match(/^(\w+)\s*=\s*(async\s+)?\(.*\)\s*=>/)) {
        if (currentFunction) {
          functions.push(currentFunction);
        }
        currentFunction = {
          name: line.substring(0, 50),
          start: index + 1,
          lines: 0
        };
      }
      
      if (currentFunction) {
        currentFunction.lines++;
        braceCount += (line.match(/{/g) || []).length;
        braceCount -= (line.match(/}/g) || []).length;
        
        if (braceCount <= 0 && currentFunction.lines > 0) {
          functions.push(currentFunction);
          currentFunction = null;
        }
      }
    });

    // 检查过长函数
    functions.forEach(func => {
      if (func.lines > 50) {
        findings.push({
          type: 'long_function',
          severity: 'info',
          message: `函数过长 (${func.lines} 行): ${func.name}`,
          category: 'maintainability',
          suggestion: '考虑拆分函数'
        });
      }
    });

    // 检查文件长度
    if (lines.length > 1000) {
      findings.push({
        type: 'large_file',
        severity: 'info',
        message: `文件较大 (${lines.length} 行)，建议拆分`,
        category: 'maintainability'
      });
    }

    return findings;
  }

  /**
   * 计算评分
   */
  _calculateScores(findings) {
    const scores = {
      codeQuality: 100,
      performance: 100,
      security: 100,
      reliability: 100,
      maintainability: 100,
      overall: 100
    };

    const penalties = {
      critical: 15,
      warning: 5,
      info: 1,
      suggestion: 2
    };

    findings.forEach(finding => {
      const penalty = penalties[finding.severity] || 0;
      const category = finding.category || 'overall';
      
      if (scores[category] !== undefined) {
        scores[category] = Math.max(0, scores[category] - penalty);
      }
      scores.overall = Math.max(0, scores.overall - penalty);
    });

    return scores;
  }

  /**
   * 生成摘要
   */
  _generateSummary(findings) {
    const summary = { critical: 0, warning: 0, info: 0, suggestions: 0 };
    
    findings.forEach(finding => {
      if (finding.severity === 'critical') summary.critical++;
      else if (finding.severity === 'warning') summary.warning++;
      else if (finding.severity === 'info') summary.info++;
      else summary.suggestions++;
    });

    return summary;
  }

  /**
   * 生成建议
   */
  _generateRecommendations(findings, scores) {
    const recommendations = [];
    
    // 基于评分生成建议
    if (scores.security < 80) {
      recommendations.push({
        priority: 'high',
        area: 'security',
        message: '安全评分较低，需要加强安全措施',
        actions: ['添加输入验证', '加密敏感信息', '使用安全依赖']
      });
    }

    if (scores.performance < 80) {
      recommendations.push({
        priority: 'high',
        area: 'performance',
        message: '性能评分较低，需要优化性能',
        actions: ['减少不必要的计算', '添加缓存', '优化算法']
      });
    }

    // 基于具体问题生成建议
    const criticalFindings = findings.filter(f => f.severity === 'critical');
    criticalFindings.forEach(finding => {
      recommendations.push({
        priority: 'critical',
        area: finding.category,
        message: finding.message,
        actions: [finding.suggestion || '立即修复']
      });
    });

    // 按优先级排序
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return recommendations;
  }

  /**
   * 生成审查报告
   */
  generateReport(reviews) {
    const report = {
      title: '代码审查报告',
      generatedAt: new Date().toISOString(),
      filesReviewed: reviews.length,
      totalFindings: reviews.reduce((sum, r) => sum + r.findings.length, 0),
      summary: {
        critical: reviews.reduce((sum, r) => sum + r.summary.critical, 0),
        warning: reviews.reduce((sum, r) => sum + r.summary.warning, 0),
        info: reviews.reduce((sum, r) => sum + r.summary.info, 0),
        suggestions: reviews.reduce((sum, r) => sum + r.summary.suggestions, 0)
      },
      averageScores: this._calculateAverageScores(reviews),
      reviews: reviews,
      overallRecommendations: this._generateOverallRecommendations(reviews)
    };

    return report;
  }

  /**
   * 计算平均评分
   */
  _calculateAverageScores(reviews) {
    const totals = { codeQuality: 0, performance: 0, security: 0, reliability: 0, maintainability: 0, overall: 0 };
    const count = reviews.length;

    reviews.forEach(review => {
      Object.entries(review.scores).forEach(([key, value]) => {
        totals[key] += value;
      });
    });

    const average = {};
    Object.entries(totals).forEach(([key, value]) => {
      average[key] = count > 0 ? Math.round(value / count) : 0;
    });

    return average;
  }

  /**
   * 生成总体建议
   */
  _generateOverallRecommendations(reviews) {
    const allFindings = reviews.flatMap(r => r.findings);
    const allRecommendations = reviews.flatMap(r => r.recommendations);
    
    // 去重并合并
    const uniqueRecommendations = [];
    const seen = new Set();
    
    allRecommendations.forEach(rec => {
      const key = `${rec.area}-${rec.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRecommendations.push(rec);
      }
    });

    return uniqueRecommendations.slice(0, 10);
  }

  /**
   * 获取审查历史
   */
  getHistory() {
    return this.reviewHistory;
  }

  /**
   * 更新审查清单
   */
  updateChecklist(checklist) {
    this.checklist = { ...this.checklist, ...checklist };
  }
}

module.exports = new CodeReviewAgent();
