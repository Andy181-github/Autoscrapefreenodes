/**
 * 多 Agent 协作系统启动器
 */

const MultiAgentSystem = require('./agents/multi-agent-system');

async function main() {
  try {
    // 执行完整的优化流程
    const results = await MultiAgentSystem.runOptimizationCycle();

    // 打印摘要
    console.log('\n' + '='.repeat(70));
    console.log('优化执行摘要');
    console.log('='.repeat(70));
    
    console.log('\n📊 项目健康度:', results.phases.reporting.summary.overallHealth + '/100');
    console.log('🔍 优化建议:', results.phases.reporting.optimization.length + ' 条');
    console.log('🐛 代码问题:', results.phases.reporting.codeQuality.issues.length + ' 个');
    console.log('✅ 测试通过率:', results.phases.reporting.testResults.summary.passRate);
    
    // 打印主要优化建议
    if (results.phases.reporting.optimization.length > 0) {
      console.log('\n🎯 优先优化建议:');
      results.phases.reporting.optimization.slice(0, 5).forEach((rec, i) => {
        console.log(`  ${i + 1}. [${rec.priority}] ${rec.insight}`);
      });
    }

    // 打印代码审查发现
    const criticalIssues = results.phases.reporting.codeQuality.issues
      .filter(i => i.severity === 'critical');
    
    if (criticalIssues.length > 0) {
      console.log('\n⚠️  严重问题需要立即修复:');
      criticalIssues.forEach(issue => {
        console.log(`  - ${issue.message}`);
      });
    }

    console.log('\n' + '='.repeat(70));
    console.log('优化流程完成!');
    console.log('='.repeat(70));

  } catch (error) {
    console.error('\n❌ 优化流程执行失败:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// 运行主函数
main();
