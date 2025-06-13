"""
Sales Representative Activity Analysis Pipeline
This script processes sales rep interactions with healthcare providers
and generates comprehensive activity reports for business analysis.
"""

import pandas as pd
from datetime import datetime, timedelta
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, count, sum, avg, max, when, datediff, current_date

# Initialize Spark session
spark = SparkSession.builder.appName("SalesRepActivityAnalysis").getOrCreate()

# Define input data sources
INTERACTIONS_TABLE = "healthcare_db.rep_interactions"
PROVIDERS_TABLE = "healthcare_db.healthcare_providers" 
REPS_TABLE = "healthcare_db.sales_representatives"
PRODUCTS_TABLE = "healthcare_db.products"

def load_source_data():
    """Load all source tables from Databricks"""
    
    # Load rep interactions (visits, calls, emails)
    interactions_df = spark.table(INTERACTIONS_TABLE)
    
    # Load healthcare provider information  
    providers_df = spark.table(PROVIDERS_TABLE)
    
    # Load sales rep details
    reps_df = spark.table(REPS_TABLE)
    
    # Load product catalog
    products_df = spark.table(PRODUCTS_TABLE)
    
    return interactions_df, providers_df, reps_df, products_df

def clean_and_transform_data(interactions_df, providers_df, reps_df, products_df):
    """Apply data quality rules and business transformations"""
    
    # Filter to last 90 days of activity
    cutoff_date = current_date() - 90
    recent_interactions = interactions_df.filter(col("interaction_date") >= cutoff_date)
    
    # Join interactions with provider and rep details
    enriched_interactions = recent_interactions \
        .join(providers_df, "provider_id", "left") \
        .join(reps_df, "rep_id", "left") \
        .join(products_df, "product_id", "left")
    
    # Calculate interaction metrics
    interaction_metrics = enriched_interactions.groupBy(
        "rep_id", "rep_name", "territory", "provider_id", 
        "provider_name", "provider_specialty", "product_id", "product_name"
    ).agg(
        count("*").alias("total_interactions"),
        sum("interaction_duration_minutes").alias("total_contact_time"),
        avg("interaction_duration_minutes").alias("avg_interaction_duration"),
        max("interaction_date").alias("last_interaction_date"),
        count(when(col("interaction_type") == "visit", 1)).alias("in_person_visits"),
        count(when(col("interaction_type") == "call", 1)).alias("phone_calls"),
        count(when(col("interaction_type") == "email", 1)).alias("email_contacts")
    )
    
    # Add calculated business metrics
    final_metrics = interaction_metrics.withColumn(
        "days_since_last_contact", 
        datediff(current_date(), col("last_interaction_date"))
    ).withColumn(
        "engagement_score",
        when(col("total_interactions") >= 10, "High")
        .when(col("total_interactions") >= 5, "Medium")
        .otherwise("Low")
    ).withColumn(
        "contact_frequency_score",
        col("total_interactions") / 90.0
    )
    
    return final_metrics

def create_summary_tables(final_metrics):
    """Generate summary tables for business reporting"""
    
    # Rep performance summary
    rep_summary = final_metrics.groupBy("rep_id", "rep_name", "territory").agg(
        count("provider_id").alias("unique_providers_contacted"),
        sum("total_interactions").alias("total_rep_interactions"),
        avg("total_contact_time").alias("avg_contact_time_per_provider"),
        sum("in_person_visits").alias("total_visits"),
        sum("phone_calls").alias("total_calls"),
        sum("email_contacts").alias("total_emails")
    )
    
    # Provider engagement summary  
    provider_summary = final_metrics.groupBy(
        "provider_id", "provider_name", "provider_specialty"
    ).agg(
        count("rep_id").alias("unique_reps_engaged"),
        sum("total_interactions").alias("total_provider_interactions"),
        max("engagement_score").alias("provider_engagement_level"),
        avg("contact_frequency_score").alias("avg_contact_frequency")
    )
    
    return rep_summary, provider_summary

def save_output_tables(final_metrics, rep_summary, provider_summary):
    """Save processed data to output tables"""
    
    # Save detailed interaction metrics
    final_metrics.write \
        .mode("overwrite") \
        .option("overwriteSchema", "true") \
        .saveAsTable("analytics_db.rep_provider_interaction_metrics")
    
    # Save rep performance summary
    rep_summary.write \
        .mode("overwrite") \
        .option("overwriteSchema", "true") \
        .saveAsTable("analytics_db.sales_rep_performance_summary")
        
    # Save provider engagement summary
    provider_summary.write \
        .mode("overwrite") \
        .option("overwriteSchema", "true") \
        .saveAsTable("analytics_db.provider_engagement_summary")

def main():
    """Main pipeline execution"""
    print("Starting Sales Rep Activity Analysis Pipeline...")
    
    # Load source data
    interactions_df, providers_df, reps_df, products_df = load_source_data()
    
    # Transform and enrich data
    final_metrics = clean_and_transform_data(interactions_df, providers_df, reps_df, products_df)
    
    # Create business summary tables
    rep_summary, provider_summary = create_summary_tables(final_metrics)
    
    # Save all output tables
    save_output_tables(final_metrics, rep_summary, provider_summary)
    
    print("Pipeline completed successfully!")
    print(f"Processed {final_metrics.count()} interaction records")

if __name__ == "__main__":
    main() 