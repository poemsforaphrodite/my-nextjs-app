import { NextRequest, NextResponse } from 'next/server';
import { searchSimilarContent, hybridSearch } from '@/lib/embeddings';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      query, 
      type = 'document',
      topK = 5,
      includeDocuments = true,
      includeCode = true,
      includeQA = true,
      minScore = 0.6,
      filter = {}
    } = body;

    // Validate required fields
    if (!query) {
      return NextResponse.json(
        { error: 'Query is required' },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes = ['document', 'code', 'qa', 'kpi', 'hybrid'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    let results;

    if (type === 'hybrid') {
      // Perform hybrid search across all content types
      results = await hybridSearch(query, {
        includeDocuments,
        includeCode,
        includeQA,
        topK,
        filter
      });
    } else {
      // Perform targeted search
      const searchResults = await searchSimilarContent(
        query,
        type as 'document' | 'code' | 'qa' | 'kpi',
        topK,
        filter
      );

      // Filter by minimum score
      const filteredResults = searchResults.filter(result => 
        (result.score || 0) >= minScore
      );

      results = {
        [type]: filteredResults,
        combined: filteredResults
      };
    }

    // Format response
    const response = {
      query,
      type,
      results,
      metadata: {
        totalResults: results.combined.length,
        searchTime: Date.now(),
        parameters: {
          topK,
          minScore,
          includeDocuments,
          includeCode,
          includeQA,
          filter
        }
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json(
      { error: 'Failed to search knowledge base' },
      { status: 500 }
    );
  }
}

// Get search suggestions
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query');
    const limit = parseInt(searchParams.get('limit') || '5');

    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter is required' },
        { status: 400 }
      );
    }

    // Get quick suggestions based on query
    const suggestions = await getSearchSuggestions(query, limit);

    return NextResponse.json({
      query,
      suggestions,
      metadata: {
        count: suggestions.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Search suggestions error:', error);
    return NextResponse.json(
      { error: 'Failed to get search suggestions' },
      { status: 500 }
    );
  }
}

// Get search suggestions
async function getSearchSuggestions(query: string, limit: number): Promise<string[]> {
  // Perform a quick hybrid search to get relevant content
  const results = await hybridSearch(query, {
    topK: limit * 2, // Get more results to extract diverse suggestions
    includeDocuments: true,
    includeCode: true,
    includeQA: true
  });

  // Extract keywords and topics from results
  const suggestions = new Set<string>();
  
  results.combined.forEach(result => {
    if (result.metadata) {
      // Add filename suggestions
      if (result.metadata.source && typeof result.metadata.source === 'string') {
        suggestions.add(result.metadata.source);
      }
      
      // Add topic suggestions
      if (result.metadata.topic && typeof result.metadata.topic === 'string') {
        suggestions.add(result.metadata.topic);
      }
      
      // Add function/class name suggestions for code
      if (result.metadata.blockName && typeof result.metadata.blockName === 'string') {
        suggestions.add(result.metadata.blockName);
      }
      
      // Add table name suggestions
      if (result.metadata.tableName && typeof result.metadata.tableName === 'string') {
        suggestions.add(result.metadata.tableName);
      }
    }
  });

  // Convert to array and limit
  return Array.from(suggestions).slice(0, limit);
}